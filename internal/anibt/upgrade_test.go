package anibt

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestArchiveUpgradeRetiresDestructiveIntentsAndPreservesReceipts(t *testing.T) {
	c := testConfig(t)
	s, e := OpenStore(filepath.Join(c.StateDir, "state.sqlite3"), false, 12)
	must(t, e)
	present, absent := strings.Repeat("a", 40), strings.Repeat("b", 40)
	for _, h := range []string{present, absent} {
		must(t, s.Enqueue(t.Context(), "cleanup", h, "verifying", "torrent:"+h, ArchiveWork{Hash: h}))
		must(t, s.Enqueue(t.Context(), "media", h, "extract", "torrent:"+h, MediaWork{Hash: h}))
	}
	_, e = s.db.Exec("UPDATE meta SET value='2' WHERE key='schema'; DROP TABLE archives; INSERT INTO receipts VALUES('content','old','completed',1)")
	must(t, e)
	must(t, s.Close())
	if wrong, e := OpenStore(filepath.Join(c.StateDir, "state.sqlite3"), false, 12); e == nil {
		wrong.Close()
		t.Fatal("runtime silently accepted obsolete deletion schema")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Fatal("upgrade sent mutation")
		}
		json.NewEncoder(w).Encode(map[string]any{"rid": 1, "full_update": true, "torrents": map[string]Torrent{present: {Hash: present, State: "stoppedUP"}}})
	}))
	defer server.Close()
	c.QBTURL = server.URL
	must(t, UpgradeState(t.Context(), c))
	s, e = OpenStore(filepath.Join(c.StateDir, "state.sqlite3"), false, 12)
	must(t, e)
	defer s.Close()
	if count(t, s, "SELECT count(*) FROM tasks WHERE lane IN ('cleanup','archive')") != 0 || count(t, s, "SELECT count(*) FROM archives") != 0 {
		t.Fatal("legacy deletion became archive")
	}
	if count(t, s, "SELECT count(*) FROM tasks WHERE lane='media' AND key=?", present) != 1 || count(t, s, "SELECT count(*) FROM tasks WHERE lane='media' AND key=?", absent) != 0 {
		t.Fatal("legacy outcome reconciled incorrectly")
	}
	var outcome string
	must(t, s.db.QueryRow("SELECT outcome FROM receipts WHERE kind='content' AND key=?", absent).Scan(&outcome))
	if outcome != "removed" {
		t.Fatal(outcome)
	}
	if count(t, s, "SELECT count(*) FROM receipts WHERE key='old'") != 1 {
		t.Fatal("permanent identity lost")
	}
	must(t, UpgradeState(t.Context(), c))
}
func TestArchiveUpgradeRequiresExclusiveWorkerLock(t *testing.T) {
	c := testConfig(t)
	lock, e := Lock(c.StateDir)
	must(t, e)
	defer lock.Close()
	if UpgradeState(t.Context(), c) == nil {
		t.Fatal("live state upgraded without process ownership")
	}
}
func TestArchiveSchemaTransactionRollback(t *testing.T) {
	s := testStore(t)
	e := s.tx(t.Context(), func(tx *sql.Tx) error {
		_, e := tx.Exec("INSERT INTO archives VALUES('a','name','/media', '[]',1)")
		if e != nil {
			return e
		}
		return ErrStale
	})
	if e != ErrStale || count(t, s, "SELECT count(*) FROM archives") != 0 {
		t.Fatal("archive write escaped transaction")
	}
}
