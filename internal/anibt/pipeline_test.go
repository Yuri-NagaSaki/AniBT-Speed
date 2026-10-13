package anibt

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMediaSampleBoundAllLimits(t *testing.T) {
	for n := 1; n < 80; n++ {
		files := []File{}
		for i := 0; i < n; i++ {
			files = append(files, File{Name: fmt.Sprintf("%03d.mkv", i), Size: int64(i + 1), Progress: 1})
		}
		for limit := 1; limit <= 20; limit++ {
			samples := SelectSamples(files, limit)
			if len(samples) != min(n, limit) {
				t.Fatalf("n=%d limit=%d got=%d", n, limit, len(samples))
			}
			found := false
			for _, f := range samples {
				if f.Size == int64(n) {
					found = true
				}
			}
			if !found {
				t.Fatal("largest file omitted")
			}
		}
	}
}
func TestMediaProgressResumesAndFailureDoesNotBlockLane(t *testing.T) {
	c := testConfig(t)
	s := testStore(t)
	ctx := t.Context()
	good := Tracks{General: map[string]any{"format": "Matroska", "duration": 100}, Video: []map[string]any{{"format": "HEVC"}}}
	m := NewMedia(c, s)
	calls := []string{}
	m.extract = func(cx context.Context, c Config, save string, f File) (Tracks, error) {
		calls = append(calls, f.Name)
		if f.Name == "bad.mkv" {
			return Tracks{}, fmt.Errorf("bad file")
		}
		return good, nil
	}
	for _, h := range []string{"a", "b"} {
		name := "one.mkv"
		if h == "a" {
			name = "bad.mkv"
		}
		must(t, s.Enqueue(ctx, "media", h, "extract", "torrent:"+h, MediaWork{Hash: h, Name: h, Files: []File{{Name: name, Size: 100, Progress: 1}, {Name: "two.mkv", Size: 200, Progress: 1}}}))
	}
	must(t, m.Step(ctx))
	if count(t, s, "SELECT count(*) FROM tasks WHERE key='a' AND attempts=1 AND due>0") != 1 {
		t.Fatal("bad item not deferred")
	}
	must(t, m.Step(ctx))
	var raw []byte
	must(t, s.db.QueryRow("SELECT data FROM tasks WHERE key='b'").Scan(&raw))
	var progress MediaWork
	must(t, json.Unmarshal(raw, &progress))
	if len(progress.Samples) != 1 {
		t.Fatal("sample progress not saved")
	}
	_, e := s.db.Exec("UPDATE tasks SET due=0 WHERE key='b'")
	must(t, e)
	m = NewMedia(c, s)
	m.extract = func(cx context.Context, c Config, save string, f File) (Tracks, error) {
		calls = append(calls, f.Name)
		return good, nil
	}
	must(t, m.Step(ctx))
	if count(t, s, "SELECT count(*) FROM tasks WHERE key='b' AND phase='upload'") != 1 {
		t.Fatal("media did not resume")
	}
	if strings.Join(calls, ",") != "bad.mkv,one.mkv,two.mkv" {
		t.Fatal("sample repeated", calls)
	}
}
func TestMediaCancellationDefersTask(t *testing.T) {
	c := testConfig(t)
	s := testStore(t)
	must(t, s.Enqueue(t.Context(), "media", "a", "extract", "torrent:a", MediaWork{Hash: "a", Files: []File{{Name: "a.mkv", Size: 10, Progress: 1}}}))
	m := NewMedia(c, s)
	m.extract = func(ctx context.Context, _ Config, _ string, _ File) (Tracks, error) {
		<-ctx.Done()
		return Tracks{}, ctx.Err()
	}
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Millisecond)
	defer cancel()
	must(t, m.Step(ctx))
	if count(t, s, "SELECT count(*) FROM tasks WHERE attempts=1 AND token='' AND due>0") != 1 {
		t.Fatal("cancelled media retained queue head")
	}
}
func TestOpenMediaRejectsTraversalAndSymlink(t *testing.T) {
	c := testConfig(t)
	outside := filepath.Join(t.TempDir(), "outside.mkv")
	must(t, os.WriteFile(outside, []byte("test"), 0600))
	must(t, os.Symlink(outside, filepath.Join(c.MediaRoot, "escape.mkv")))
	for _, name := range []string{"../outside.mkv", "/etc/passwd", "escape.mkv"} {
		if f, e := OpenMedia(c, c.QBTRoot, name); e == nil {
			f.Close()
			t.Fatal("unsafe path opened", name)
		}
	}
	must(t, os.WriteFile(filepath.Join(c.MediaRoot, "ok.mkv"), []byte("test"), 0600))
	f, e := OpenMedia(c, c.QBTRoot, "ok.mkv")
	must(t, e)
	f.Close()
}
func TestCollectionDoesNotInventDuration(t *testing.T) {
	w := MediaWork{Hash: "hash", Name: "Series", Files: []File{{Name: "1.mkv", Size: 10, Progress: 1}, {Name: "2.mkv", Size: 20, Progress: 1}}, Samples: map[string]Tracks{"2.mkv": {General: map[string]any{"duration": 120, "fileSize": 20}, Video: []map[string]any{{"format": "AVC"}}}}}
	b, e := BuildPayload(w)
	must(t, e)
	var payload struct {
		General map[string]any `json:"general"`
		Raw     string         `json:"rawText"`
	}
	must(t, json.Unmarshal(b, &payload))
	if _, ok := payload.General["duration"]; ok {
		t.Fatal("sample duration extrapolated")
	}
	if payload.General["fileSize"] != float64(30) || !strings.Contains(payload.Raw, "sampled: 1") {
		t.Fatal(string(b))
	}
}
func TestNotificationRetries429AcrossRestart(t *testing.T) {
	c := testConfig(t)
	s := testStore(t)
	ctx := t.Context()
	must(t, s.Enqueue(ctx, "notify", "summary:test", "send", "notify:test", Notification{Text: "test", Summary: "test"}))
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.WriteHeader(429)
			fmt.Fprint(w, `{"ok":false,"error_code":429,"parameters":{"retry_after":120}}`)
		} else {
			fmt.Fprint(w, `{"ok":true}`)
		}
	}))
	defer server.Close()
	n := NewNotifier(c, s)
	n.base = server.URL
	if e := n.Step(ctx); e == nil {
		t.Fatal("429 did not back off notification lane")
	}
	if count(t, s, "SELECT count(*) FROM receipts WHERE kind='summary'") != 0 || count(t, s, "SELECT count(*) FROM tasks WHERE attempts=1 AND due>=?", time.Now().Add(115*time.Second).Unix()) != 1 {
		t.Fatal("429 dropped task or marked summary delivered")
	}
	file := s.path
	must(t, s.Close())
	var e error
	s, e = OpenStore(file, true, 12)
	must(t, e)
	defer s.Close()
	_, e = s.db.Exec("UPDATE tasks SET due=0")
	must(t, e)
	n = NewNotifier(c, s)
	n.base = server.URL
	must(t, n.Step(ctx))
	if count(t, s, "SELECT count(*) FROM tasks") != 0 || count(t, s, "SELECT count(*) FROM receipts WHERE kind='summary'") != 1 {
		t.Fatal("retry was not delivered")
	}
}
func TestMalformedSeasonDoesNotPoisonBatch(t *testing.T) {
	c := testConfig(t)
	s := testStore(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `[]`) }))
	defer server.Close()
	c.APIRoot = server.URL
	f := NewFeeds(c, s)
	for _, key := range []string{"a", "b"} {
		d := Download{Key: key, Slug: "g", Title: key, URL: "magnet:?xt=urn:btih:" + fmt.Sprintf("%040x", 1)}
		if key == "a" {
			d.BgmID = "123"
		}
		must(t, s.Enqueue(t.Context(), "download", key, "pending", "release:"+key, d))
	}
	must(t, f.Prepare(t.Context()))
	if count(t, s, "SELECT count(*) FROM tasks WHERE key='a' AND attempts=1") != 1 || count(t, s, "SELECT count(*) FROM tasks WHERE key='b' AND phase='ready'") != 1 {
		t.Fatal("malformed upstream starved healthy item")
	}
}
func TestRSSConditional304PreservesInitialization(t *testing.T) {
	c := testConfig(t)
	s := testStore(t)
	ctx := t.Context()
	must(t, s.SyncFeeds(ctx, map[string]string{"g": "Group"}, c))
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if requests == 1 {
			w.Header().Set("ETag", `"v1"`)
			fmt.Fprint(w, `<rss><channel></channel></rss>`)
		} else {
			if r.Header.Get("If-None-Match") != `"v1"` {
				t.Error("conditional header absent")
			}
			w.WriteHeader(304)
		}
	}))
	defer server.Close()
	c.APIRoot = server.URL
	f := NewFeeds(c, s)
	feeds, e := s.Feeds(ctx)
	must(t, e)
	must(t, f.pollOne(ctx, feeds[0]))
	feeds, e = s.Feeds(ctx)
	must(t, e)
	if !feeds[0].Initialized {
		t.Fatal("initialization lost")
	}
	must(t, f.pollOne(ctx, feeds[0]))
	if count(t, s, "SELECT count(*) FROM tasks") != 0 {
		t.Fatal("304 produced work")
	}
}
func TestSourceXMLUsesExactGroupIdentity(t *testing.T) {
	c := testConfig(t)
	c.FeedMaxAge = 0
	b := []byte(`<rss xmlns:anibt="https://anibt.net/xmlns/rss/1.0/"><channel><item><title>Yani Neko</title><guid>rel</guid><anibt:groupSlug>good</anibt:groupSlug><anibt:torrentUrl>magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</anibt:torrentUrl></item></channel></rss>`)
	entries, e := parseFeed(b, Feed{Slug: "good", Name: "Good"}, c, time.Now())
	must(t, e)
	if len(entries) != 1 || entries[0].Reject != "" {
		t.Fatal(entries)
	}
	entries, e = parseFeed(b, Feed{Slug: "wrong"}, c, time.Now())
	must(t, e)
	if entries[0].Reject != "group identity mismatch" {
		t.Fatal(entries)
	}
}

func TestReducedMediaSampleLimitCompletesExistingProgress(t *testing.T) {
	c := testConfig(t)
	c.MediaSamples = 1
	s := testStore(t)
	ctx := t.Context()
	tracks := Tracks{General: map[string]any{"format": "Matroska", "duration": 1}, Video: []map[string]any{{"format": "HEVC"}}}
	w := MediaWork{Hash: "h", Files: []File{{Name: "1.mkv", Size: 1, Progress: 1}, {Name: "2.mkv", Size: 2, Progress: 1}}, Samples: map[string]Tracks{"1.mkv": tracks, "2.mkv": tracks}}
	must(t, s.Enqueue(ctx, "media", "h", "extract", "torrent:h", w))
	m := NewMedia(c, s)
	m.extract = func(context.Context, Config, string, File) (Tracks, error) {
		t.Fatal("already complete sample read twice")
		return Tracks{}, nil
	}
	must(t, m.Step(ctx))
	if count(t, s, "SELECT count(*) FROM tasks WHERE phase='upload'") != 1 {
		t.Fatal("config change trapped completed samples")
	}
}
func TestMediaPathCorrectionFencesReaderAndKeepsOwnership(t *testing.T) {
	c := testConfig(t)
	s := testStore(t)
	ctx := t.Context()
	h := strings.Repeat("b", 40)
	old := Torrent{Hash: h, Name: "name", Category: c.Category, SavePath: c.QBTRoot + "/old", ContentPath: c.QBTRoot + "/old/file", State: "stoppedUP", Progress: 1}
	snap := Snapshot{At: time.Now().Unix(), Torrents: map[string]Torrent{h: old}}
	_, e := s.Observe(ctx, snap, nil, c)
	must(t, e)
	m := claim(t, s, "media", "manifest")
	must(t, s.Transition(ctx, m, "extract", m.Resource, MediaWork{Hash: h, SavePath: old.SavePath, Files: []File{{Name: "file.mkv", Size: 1, Progress: 1}}}, 0))
	active := claim(t, s, "media", "extract")
	newTorrent := old
	newTorrent.SavePath = c.QBTRoot + "/new"
	snap.Torrents = map[string]Torrent{h: newTorrent}
	_, e = s.Observe(ctx, snap, map[string]Torrent{h: old}, c)
	must(t, e)
	if e = s.Transition(ctx, active, "upload", active.Resource, MediaWork{}, 0); !errors.Is(e, ErrStale) {
		t.Fatal("old path result accepted", e)
	}
	must(t, s.Enqueue(ctx, "archive", h, "ready", "torrent:"+h, ArchiveWork{Hash: h}))
	del, e := s.Claim(ctx, "archive", []string{"ready"}, time.Minute)
	must(t, e)
	if del != nil {
		t.Fatal("invalidated reader resource released too early")
	}
	if count(t, s, "SELECT count(*) FROM tasks WHERE lane='media' AND phase='manifest' AND json_extract(data,'$.save_path')=?", newTorrent.SavePath) != 1 {
		t.Fatal("new path not queued")
	}
}

func TestMediaDependencyOutageDoesNotConsumeItemAttempts(t *testing.T) {
	c := testConfig(t)
	s := testStore(t)
	ctx := t.Context()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer server.Close()
	c.APIRoot = server.URL
	must(t, s.Enqueue(ctx, "media", "h", "upload", "torrent:h", MediaWork{Hash: "h", Payload: json.RawMessage(`{"infoHash":"h"}`)}))
	m := NewMedia(c, s)
	if e := m.Step(ctx); e == nil {
		t.Fatal("dependency outage did not back off lane")
	}
	if count(t, s, "SELECT count(*) FROM tasks WHERE attempts=0 AND error<>'' AND token='' AND due>0") != 1 {
		t.Fatal("dependency outage exhausted item retries")
	}
}
