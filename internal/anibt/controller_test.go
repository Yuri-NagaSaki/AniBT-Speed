package anibt

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestArchiveRemovesQBTAndRetainsFilesAndMediaAcrossRestart(t *testing.T) {
	c := testConfig(t)
	c.Pool = false
	c.Media = true
	c.Notify = true
	c.MinFreeGiB = 0
	c.MaxDiskPercent = 100
	s := testStore(t)
	hash := strings.Repeat("a", 40)
	save := c.QBTRoot + "/item"
	file := filepath.Join(c.MediaRoot, "item", "file.mkv")
	must(t, os.Mkdir(filepath.Dir(file), 0700))
	must(t, os.WriteFile(file, []byte("abcd"), 0600))
	torrent := Torrent{Hash: hash, Name: "item", Category: c.Category, SavePath: save, ContentPath: save + "/file.mkv", Progress: 1, State: "stalledUP", CompletedAt: time.Now().Add(-100 * 24 * time.Hour).Unix()}
	removed := false
	calls, removals := 0, 0
	var commands []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		switch r.URL.Path {
		case "/api/v2/sync/maindata":
			ts := map[string]Torrent{}
			if !removed {
				ts[hash] = torrent
			}
			json.NewEncoder(w).Encode(map[string]any{"rid": calls, "full_update": true, "torrents": ts, "server_state": map[string]any{"alltime_ul": 100, "alltime_dl": 0, "free_space_on_disk": 1 << 40}, "categories": map[string]any{"AniBT": map[string]any{}}})
		case "/api/v2/torrents/files":
			if removed {
				t.Error("manifest requested after qB removal")
			}
			fmt.Fprint(w, `[{"name":"file.mkv","size":4,"progress":1}]`)
		case "/api/v2/torrents/stop":
			commands = append(commands, "stop")
			torrent.State = "stoppedUP"
		case "/api/v2/torrents/delete":
			r.ParseForm()
			commands = append(commands, "archive")
			if r.Form.Get("hashes") != hash || r.Form.Get("deleteFiles") != "false" {
				os.Remove(file)
				t.Error("archive requested destructive deletion")
			}
			removed = true
			removals++
		case "/api/releases/mediainfo":
			fmt.Fprint(w, `{"ok":true}`)
		default:
			t.Error("unexpected endpoint", r.URL.Path)
		}
	}))
	defer server.Close()
	c.QBTURL = server.URL
	c.APIRoot = server.URL
	controller := NewController(c, s, NewQBT(c, false))
	must(t, controller.Cycle(t.Context()))
	if !removed || count(t, s, "SELECT count(*) FROM tasks WHERE lane='archive' AND phase='verifying'") != 1 {
		t.Fatal("archive not recorded before qB removal")
	}
	if strings.Join(commands, ",") != "stop,archive" {
		t.Fatal(commands)
	}
	if count(t, s, "SELECT count(*) FROM receipts WHERE kind='archive'") != 0 || count(t, s, "SELECT count(*) FROM tasks WHERE lane='notify'") != 0 {
		t.Fatal("archive success claimed before verification")
	}
	if calls > c.Commands+1 {
		t.Fatal("request budget exceeded", calls)
	}
	must(t, s.Recover(t.Context()))
	controller = NewController(c, s, NewQBT(c, false))
	must(t, controller.Cycle(t.Context()))
	if removals != 1 || count(t, s, "SELECT count(*) FROM tasks WHERE lane='archive'") != 0 || count(t, s, "SELECT count(*) FROM receipts WHERE kind='archive'") != 1 {
		t.Fatal("archive reconciliation not idempotent")
	}
	if count(t, s, "SELECT count(*) FROM tasks WHERE lane='notify' AND json_extract(data,'$.text') LIKE '%文件保留%'") != 1 {
		t.Fatal("archive delivery semantics absent")
	}
	data, e := os.ReadFile(file)
	must(t, e)
	if string(data) != "abcd" {
		t.Fatal("content altered")
	}
	records, e := s.Archives(t.Context())
	must(t, e)
	if len(records) != 1 || records[0].SavePath != save {
		t.Fatal(records)
	}
	if count(t, s, "SELECT count(*) FROM tasks WHERE lane='media' AND phase='extract'") != 1 {
		t.Fatal("pending media work discarded")
	}
	m := NewMedia(c, s)
	m.extract = func(_ context.Context, c Config, save string, f File) (Tracks, error) {
		handle, e := OpenMedia(c, save, f.Name)
		if e != nil {
			return Tracks{}, e
		}
		handle.Close()
		return Tracks{General: map[string]any{"format": "Matroska", "fileSize": 4}, Video: []map[string]any{{"format": "HEVC"}}}, nil
	}
	must(t, m.Step(t.Context()))
	_, e = s.db.Exec("UPDATE tasks SET due=0 WHERE lane='media'")
	must(t, e)
	must(t, m.Step(t.Context()))
	if count(t, s, "SELECT count(*) FROM receipts WHERE kind='media' AND outcome='delivered'") != 1 {
		t.Fatal("archived media not delivered")
	}
	d := Download{Key: "new-alias", Hash: hash}
	must(t, s.Enqueue(t.Context(), "download", d.Key, "pending", "release:"+d.Key, d))
	job := claim(t, s, "download", "pending")
	must(t, s.Ready(t.Context(), job, d))
	if count(t, s, "SELECT count(*) FROM tasks WHERE lane='download'") != 0 {
		t.Fatal("archive redownloaded under new release id")
	}
}
func TestDiskPressurePausesIntakeWithoutEarlyArchive(t *testing.T) {
	c := testConfig(t)
	c.Pool = false
	c.Media = false
	c.Notify = false
	s := testStore(t)
	hash := strings.Repeat("b", 40)
	torrent := Torrent{Hash: hash, Category: c.Category, SavePath: c.QBTRoot + "/item", ContentPath: c.QBTRoot + "/item/file.mkv", State: "stoppedUP", Progress: 1, CompletedAt: time.Now().Add(-24 * time.Hour).Unix()}
	posts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			posts++
			t.Error("disk pressure caused qB mutation", r.URL.Path)
		}
		json.NewEncoder(w).Encode(map[string]any{"rid": 1, "full_update": true, "torrents": map[string]Torrent{hash: torrent}, "server_state": map[string]any{"alltime_ul": 1, "alltime_dl": 0, "free_space_on_disk": 0}, "categories": map[string]any{"AniBT": map[string]any{}}})
	}))
	defer server.Close()
	c.QBTURL = server.URL
	must(t, s.Enqueue(t.Context(), "download", "new", "ready", "torrent:"+strings.Repeat("c", 40), Download{Key: "new", Hash: strings.Repeat("c", 40)}))
	controller := NewController(c, s, NewQBT(c, false))
	must(t, controller.Cycle(t.Context()))
	if posts != 0 || count(t, s, "SELECT count(*) FROM tasks WHERE lane='archive'") != 0 || controller.Summary()["intake_paused"] != true {
		t.Fatal("disk pressure policy violated")
	}
}
func TestArchiveSubmissionAllowanceIsDurable(t *testing.T) {
	c := testConfig(t)
	s := testStore(t)
	h := strings.Repeat("a", 40)
	w := ArchiveWork{Hash: h, Requested: 1, Submissions: c.MaxAttempts}
	must(t, s.Enqueue(t.Context(), "archive", h, "verifying", "torrent:"+h, w))
	controller := NewController(c, s, NewQBT(c, true))
	must(t, controller.reconcileArchives(t.Context(), Snapshot{At: time.Now().Unix(), Torrents: map[string]Torrent{h: {Hash: h}}}))
	if count(t, s, "SELECT count(*) FROM tasks WHERE lane='archive' AND phase='blocked'") != 1 {
		t.Fatal("archive retried indefinitely")
	}
}
func TestArchiveCannotClaimSuccessWhenLocalFilesDisappear(t *testing.T) {
	c := testConfig(t)
	s := testStore(t)
	s.MaxAttempts = 1
	h := strings.Repeat("a", 40)
	w := ArchiveWork{Hash: h, SavePath: c.QBTRoot, Requested: 1, Files: []File{{Name: "missing.mkv", Size: 10, Progress: 1}}}
	must(t, s.Enqueue(t.Context(), "archive", h, "verifying", "torrent:"+h, w))
	controller := NewController(c, s, NewQBT(c, true))
	must(t, controller.reconcileArchives(t.Context(), Snapshot{At: time.Now().Unix(), Torrents: map[string]Torrent{}}))
	if count(t, s, "SELECT count(*) FROM receipts WHERE kind='archive'") != 0 || count(t, s, "SELECT count(*) FROM tasks WHERE lane='archive' AND phase='blocked'") != 1 {
		t.Fatal("missing files recorded as retained")
	}
	must(t, s.Operate(t.Context(), "retry", "archive:"+h))
	if count(t, s, "SELECT count(*) FROM tasks WHERE lane='archive' AND phase='verifying'") != 1 {
		t.Fatal("operator retry discarded archive manifest")
	}
}

func TestArchivedManifestAvailableAfterMediaRetry(t *testing.T) {
	c := testConfig(t)
	s := testStore(t)
	ctx := t.Context()
	hash := strings.Repeat("c", 40)
	w := ArchiveWork{Hash: hash, Name: "local", SavePath: c.QBTRoot, Files: []File{{Name: "local.mkv", Size: 4, Progress: 1}}}
	must(t, os.WriteFile(filepath.Join(c.MediaRoot, "local.mkv"), []byte("abcd"), 0600))
	must(t, s.Enqueue(ctx, "archive", hash, "verifying", "torrent:"+hash, w))
	task := claim(t, s, "archive", "verifying")
	must(t, s.CompleteArchive(ctx, task, w, true, time.Now().Unix()))
	_, e := s.db.Exec("UPDATE tasks SET phase='blocked',error='local read failed' WHERE lane='media'")
	must(t, e)
	must(t, s.Operate(ctx, "retry", "media:"+hash))
	c.QBTURL = "http://127.0.0.1:1"
	controller := NewController(c, s, NewQBT(c, true))
	did, e := controller.manifest(ctx, Snapshot{Torrents: map[string]Torrent{}})
	must(t, e)
	if !did || count(t, s, "SELECT count(*) FROM tasks WHERE lane='media' AND phase='extract'") != 1 || controller.q.Requests != 0 {
		t.Fatal("media retry depended on removed qB manifest")
	}
	must(t, s.Maintain(ctx, c, 0))
	if count(t, s, "SELECT count(*) FROM archives") != 1 {
		t.Fatal("archive records pruned")
	}
}

func TestOperatorRetryRenewsArchiveSubmissionAllowance(t *testing.T) {
	c := testConfig(t)
	s := testStore(t)
	h := strings.Repeat("d", 40)
	w := ArchiveWork{Hash: h, SavePath: c.QBTRoot, Requested: 1, Submissions: c.MaxAttempts, Files: []File{{Name: "f.mkv", Size: 1, Progress: 1}}}
	must(t, s.Enqueue(t.Context(), "archive", h, "blocked", "torrent:"+h, w))
	must(t, s.Operate(t.Context(), "retry", "archive:"+h))
	controller := NewController(c, s, NewQBT(c, true))
	must(t, controller.reconcileArchives(t.Context(), Snapshot{At: time.Now().Unix(), Torrents: map[string]Torrent{h: {Hash: h}}}))
	if count(t, s, "SELECT count(*) FROM tasks WHERE lane='archive' AND phase='ready'") != 1 {
		t.Fatal("operator retry did not renew bounded submission attempts")
	}
}
