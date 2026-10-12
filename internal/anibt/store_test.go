package anibt

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

func testConfig(t testing.TB) Config {
	t.Helper()
	t.Setenv("ANIBT_QBT_API_KEY", "test-key")
	t.Setenv("ANIBT_API_TOKEN", "test-token")
	t.Setenv("ANIBT_TELEGRAM_TOKEN", "test-bot")
	t.Setenv("ANIBT_TELEGRAM_CHAT_ID", "test-chat")
	c, e := LoadConfig("")
	if e != nil {
		t.Fatal(e)
	}
	c.StateDir = t.TempDir()
	c.MediaRoot = t.TempDir()
	return c
}
func testStore(t testing.TB) *Store {
	t.Helper()
	s, e := OpenStore(filepath.Join(t.TempDir(), "state.sqlite3"), true, 12)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func must(t testing.TB, e error) {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
}
func count(t testing.TB, s *Store, q string, args ...any) int {
	t.Helper()
	var n int
	must(t, s.db.QueryRow(q, args...).Scan(&n))
	return n
}
func claim(t testing.TB, s *Store, lane string, phases ...string) Task {
	t.Helper()
	v, e := s.Claim(context.Background(), lane, phases, time.Minute)
	must(t, e)
	if v == nil {
		t.Fatal("no task claimed")
	}
	return *v
}
func TestClaimFencesMediaAgainstCleanup(t *testing.T) {
	s := testStore(t)
	ctx := t.Context()
	resource := "torrent:abc"
	must(t, s.Enqueue(ctx, "media", "abc", "extract", resource, MediaWork{Hash: "abc"}))
	m := claim(t, s, "media", "extract")
	must(t, s.Enqueue(ctx, "cleanup", "abc", "ready", resource, CleanupWork{Hash: "abc"}))
	c, e := s.Claim(ctx, "cleanup", []string{"ready"}, time.Minute)
	must(t, e)
	if c != nil {
		t.Fatal("cleanup overlapped extraction")
	}
	must(t, s.Transition(ctx, m, "upload", resource, MediaWork{Hash: "abc"}, 0))
	del := claim(t, s, "cleanup", "ready")
	must(t, s.Transition(ctx, del, "verifying", resource, CleanupWork{Hash: "abc"}, 0))
	next, e := s.Claim(ctx, "media", []string{"upload"}, time.Minute)
	must(t, e)
	if next != nil {
		t.Fatal("media started while delete awaited reconciliation")
	}
	if !errors.Is(s.Finish(ctx, m, "media", "abc", "delivered", ""), ErrStale) {
		t.Fatal("stale media writer committed")
	}
}
func TestExpiredLeaseRejectsLateResult(t *testing.T) {
	s := testStore(t)
	ctx := t.Context()
	must(t, s.Enqueue(ctx, "media", "a", "extract", "torrent:a", MediaWork{}))
	old := claim(t, s, "media", "extract")
	_, e := s.db.Exec("UPDATE tasks SET lease=0; UPDATE owners SET until=0")
	must(t, e)
	next := claim(t, s, "media", "extract")
	if old.Token == next.Token {
		t.Fatal("token reused")
	}
	if !errors.Is(s.Finish(ctx, old, "media", "a", "delivered", ""), ErrStale) {
		t.Fatal("expired completion accepted")
	}
	must(t, s.Finish(ctx, next, "media", "a", "delivered", ""))
}
func TestCancelledQueuedDatabaseWriteDoesNotCommit(t *testing.T) {
	s := testStore(t)
	conn, e := s.db.Conn(t.Context())
	must(t, e)
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- s.Enqueue(ctx, "media", "late", "extract", "r", MediaWork{}) }()
	e = <-done
	if !errors.Is(e, context.DeadlineExceeded) {
		t.Fatalf("expected deadline, got %v", e)
	}
	must(t, conn.Close())
	if n := count(t, s, "SELECT count(*) FROM tasks"); n != 0 {
		t.Fatal("cancelled queued write committed")
	}
}
func TestSourceCorrectionsFencePreparedRevision(t *testing.T) {
	s := testStore(t)
	ctx := t.Context()
	c := testConfig(t)
	must(t, s.SyncFeeds(ctx, map[string]string{"g": "Group"}, c))
	feed := Feed{Slug: "g", Name: "Group"}
	entry := Entry{Download: Download{Key: "rel", Slug: "g", URL: "old", Title: "old"}}
	must(t, s.Ingest(ctx, feed, []Entry{entry}, "a", "", false))
	old := claim(t, s, "download", "pending")
	entry.URL = "new"
	entry.Title = "corrected"
	must(t, s.Ingest(ctx, feed, []Entry{entry}, "b", "", false))
	if !errors.Is(s.Ready(ctx, old, Download{Key: "rel", Hash: fmt.Sprintf("%040x", 1)}), ErrStale) {
		t.Fatal("source correction accepted old artifact")
	}
	next := claim(t, s, "download", "pending")
	var d Download
	must(t, json.Unmarshal(next.Data, &d))
	if d.URL != "new" {
		t.Fatal("correction not visible")
	}
}
func TestRejectedFeedCannotPoisonCorrectFeed(t *testing.T) {
	s := testStore(t)
	c := testConfig(t)
	ctx := t.Context()
	must(t, s.SyncFeeds(ctx, map[string]string{"wrong": "Wrong", "right": "Right"}, c))
	d := Download{Key: "rel", Slug: "right", URL: "magnet:test"}
	must(t, s.Ingest(ctx, Feed{Slug: "wrong"}, []Entry{{Download: d, Reject: "group identity mismatch", ScopeOnly: true}}, "", "", false))
	must(t, s.Ingest(ctx, Feed{Slug: "right"}, []Entry{{Download: d}}, "", "", false))
	if count(t, s, "SELECT count(*) FROM tasks WHERE lane='download'") != 1 || count(t, s, "SELECT count(*) FROM receipts WHERE kind='release'") != 0 {
		t.Fatal("scoped rejection poisoned global identity")
	}
}
func TestContentReceiptSurvivesMaintenance(t *testing.T) {
	s := testStore(t)
	ctx := t.Context()
	c := testConfig(t)
	hash := fmt.Sprintf("%040x", 1)
	must(t, s.tx(ctx, func(tx *sql.Tx) error { return receipt(ctx, tx, "content", hash, "completed", 1) }))
	must(t, s.Maintain(ctx, c, 0))
	must(t, s.Enqueue(ctx, "download", "new-id", "pending", "release:new-id", Download{}))
	task := claim(t, s, "download", "pending")
	must(t, s.Ready(ctx, task, Download{Key: "new-id", Hash: hash}))
	if count(t, s, "SELECT count(*) FROM tasks WHERE lane='download'") != 0 {
		t.Fatal("permanent content receipt lost")
	}
}
func TestTrafficGapIsUnknown(t *testing.T) {
	s := testStore(t)
	c := testConfig(t)
	ctx := t.Context()
	now := time.Now().Unix()
	snap := Snapshot{At: now - 48*3600, Server: map[string]float64{"alltime_ul": 0, "alltime_dl": 0}, Torrents: map[string]Torrent{}}
	_, e := s.Observe(ctx, snap, nil, c)
	must(t, e)
	snap.At = now
	snap.Server["alltime_ul"] = 10 * (1 << 40)
	_, e = s.Observe(ctx, snap, map[string]Torrent{}, c)
	must(t, e)
	w, e := s.Traffic(ctx, now, time.Hour)
	must(t, e)
	if w.Uploaded != 0 || w.Coverage != 0 {
		t.Fatalf("gap attributed to recent hour: %+v", w)
	}
	snap.At = now + 30
	snap.Server["alltime_ul"] += 300
	_, e = s.Observe(ctx, snap, map[string]Torrent{}, c)
	must(t, e)
	w, e = s.Traffic(ctx, now+30, 15*time.Second)
	must(t, e)
	if w.Uploaded != 150 || w.Coverage != 15 {
		t.Fatalf("interval clipping failed: %+v", w)
	}
}
func TestBusinessEventAndOutboxAtomic(t *testing.T) {
	s := testStore(t)
	ctx := t.Context()
	must(t, s.Enqueue(ctx, "media", "hash", "upload", "hash", MediaWork{}))
	task := claim(t, s, "media", "upload")
	must(t, s.Finish(ctx, task, "media", "hash", "done", "delivered"))
	if count(t, s, "SELECT count(*) FROM tasks WHERE lane='notify'") != 1 || count(t, s, "SELECT count(*) FROM receipts WHERE kind='media'") != 1 {
		t.Fatal("receipt and outbox not committed together")
	}
	stats, e := s.Stats(ctx)
	must(t, e)
	if stats["receipt:media"] != 1 || stats["task:notify:send"] != 1 {
		t.Fatal(stats)
	}
}
func TestSubmittedRevisionReconcilesBeforeCorrection(t *testing.T) {
	s := testStore(t)
	c := testConfig(t)
	ctx := t.Context()
	must(t, s.SyncFeeds(ctx, map[string]string{"g": "g"}, c))
	f := Feed{Slug: "g"}
	original := Download{Key: "rel", Slug: "g", URL: "old"}
	must(t, s.Ingest(ctx, f, []Entry{{Download: original}}, "", "", false))
	pending := claim(t, s, "download", "pending")
	original.Hash = fmt.Sprintf("%040x", 1)
	must(t, s.Ready(ctx, pending, original))
	ready := claim(t, s, "download", "ready")
	must(t, s.Submitting(ctx, ready, original))
	corrected := Download{Key: "rel", Slug: "g", URL: "new"}
	must(t, s.Ingest(ctx, f, []Entry{{Download: corrected}}, "", "", false))
	tasks, e := s.Downloads(ctx)
	must(t, e)
	var d Download
	must(t, json.Unmarshal(tasks[0].Data, &d))
	if d.Hash != original.Hash || tasks[0].Phase != "submitted" {
		t.Fatal("ambiguous submission overwritten")
	}
	must(t, s.ReconcileDownload(ctx, tasks[0], map[string]Torrent{d.Hash: {Hash: d.Hash, Progress: 0.2, State: "downloading"}}, c))
	if count(t, s, "SELECT count(*) FROM receipts WHERE kind='content' AND key=?", original.Hash) != 1 {
		t.Fatal("submitted hash not reconciled")
	}
}
func TestMaxSubmissionAttemptsBlock(t *testing.T) {
	s := testStore(t)
	c := testConfig(t)
	ctx := t.Context()
	d := Download{Key: "rel", Hash: fmt.Sprintf("%040x", 1), Submissions: c.MaxAttempts, Submitted: 1}
	must(t, s.Enqueue(ctx, "download", "rel", "submitted", "torrent:"+d.Hash, d))
	_, e := s.db.Exec("INSERT INTO sources VALUES(?,?,?,?,?)", d.Key, "g", "v", encode(Download{Key: d.Key}), 1)
	must(t, e)
	tasks, e := s.Downloads(ctx)
	must(t, e)
	must(t, s.ReconcileDownload(ctx, tasks[0], map[string]Torrent{}, c))
	if count(t, s, "SELECT count(*) FROM tasks WHERE phase='blocked'") != 1 {
		t.Fatal("submission retries unbounded")
	}
}

func TestOperatorReplayKeepsPermanentContentReceipt(t *testing.T) {
	s := testStore(t)
	c := testConfig(t)
	ctx := t.Context()
	hash := fmt.Sprintf("%040x", 1)
	must(t, s.SyncFeeds(ctx, map[string]string{"g": "Group"}, c))
	d := Download{Key: "release", Slug: "g", Title: "release", URL: "magnet:old"}
	must(t, s.Ingest(ctx, Feed{Slug: "g"}, []Entry{{Download: d}}, "", "", false))
	task := claim(t, s, "download", "pending")
	d.Hash = hash
	must(t, s.Ready(ctx, task, d))
	task = claim(t, s, "download", "ready")
	must(t, s.Finish(ctx, task, "content", hash, "completed", ""))
	must(t, s.Operate(ctx, "replay", d.Key))
	pending := claim(t, s, "download", "pending")
	must(t, s.Ready(ctx, pending, d))
	if count(t, s, "SELECT count(*) FROM receipts WHERE kind='content' AND key=?", hash) != 1 || count(t, s, "SELECT count(*) FROM tasks WHERE phase='ready'") != 1 {
		t.Fatal("replay removed permanent receipt or failed to permit explicit work")
	}
	if count(t, s, "SELECT count(*) FROM meta WHERE key=?", "replay:"+d.Key) != 0 {
		t.Fatal("replay permission not consumed")
	}
}
