package anibt

import (
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

func TestControllerConfirmsDeletionOnlyAfterAbsence(t *testing.T) {
	c := testConfig(t)
	c.Pool = false
	c.Media = false
	c.Notify = true
	c.ControlBudget = 5 * time.Second
	c.ControlInterval = 5 * time.Second
	c.MinFreeGiB = 0
	c.MaxDiskPercent = 100
	s := testStore(t)
	hash := strings.Repeat("a", 40)
	save := c.QBTRoot + "/item"
	torrent := Torrent{Hash: hash, Name: "item", Category: c.Category, SavePath: save, ContentPath: save + "/file.mkv", Progress: 1, State: "stoppedUP", CompletedAt: time.Now().Add(-100 * 24 * time.Hour).Unix()}
	must(t, os.Mkdir(filepath.Join(c.MediaRoot, "item"), 0700))
	must(t, os.WriteFile(filepath.Join(c.MediaRoot, "item", "file.mkv"), []byte("abcd"), 0600))
	deleted := false
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		switch r.URL.Path {
		case "/api/v2/sync/maindata":
			torrents := map[string]Torrent{}
			if !deleted {
				torrents[hash] = torrent
			}
			json.NewEncoder(w).Encode(map[string]any{"rid": calls, "full_update": true, "torrents": torrents, "server_state": map[string]any{"alltime_ul": 100, "alltime_dl": 0, "free_space_on_disk": 1 << 40}, "categories": map[string]any{"AniBT": map[string]any{}}})
		case "/api/v2/torrents/files":
			fmt.Fprint(w, `[{"name":"file.mkv","size":4,"progress":1}]`)
		case "/api/v2/torrents/delete":
			r.ParseForm()
			if r.Form.Get("hashes") != hash || r.Form.Get("deleteFiles") != "true" {
				t.Error("incorrect deletion request")
			}
			deleted = true
		default:
			t.Error("unexpected endpoint", r.URL.Path)
		}
	}))
	defer server.Close()
	c.QBTURL = server.URL
	controller := NewController(c, s, NewQBT(c, false))
	must(t, controller.Cycle(t.Context()))
	if !deleted || count(t, s, "SELECT count(*) FROM tasks WHERE lane='cleanup' AND phase='verifying'") != 1 {
		t.Fatal("delete not recorded as ambiguous")
	}
	if count(t, s, "SELECT count(*) FROM tasks WHERE lane='notify'") != 0 {
		t.Fatal("cleanup announced before observation")
	}
	if calls > c.Commands+1 {
		t.Fatal("qB operation budget exceeded", calls)
	}
	must(t, controller.Cycle(t.Context()))
	if count(t, s, "SELECT count(*) FROM tasks WHERE lane='cleanup'") != 0 || count(t, s, "SELECT count(*) FROM tasks WHERE lane='notify'") != 1 {
		t.Fatal("deletion absence not reconciled")
	}
}
func TestCleanupSubmissionAllowanceIsDurable(t *testing.T) {
	c := testConfig(t)
	s := testStore(t)
	hash := strings.Repeat("a", 40)
	w := CleanupWork{Hash: hash, Requested: 1, Submissions: c.MaxAttempts}
	must(t, s.Enqueue(t.Context(), "cleanup", hash, "verifying", "torrent:"+hash, w))
	controller := NewController(c, s, NewQBT(c, true))
	must(t, controller.reconcileCleanup(t.Context(), Snapshot{At: time.Now().Unix(), Torrents: map[string]Torrent{hash: {Hash: hash}}}))
	if count(t, s, "SELECT count(*) FROM tasks WHERE lane='cleanup' AND phase='blocked'") != 1 {
		t.Fatal("cleanup retried indefinitely")
	}
}
