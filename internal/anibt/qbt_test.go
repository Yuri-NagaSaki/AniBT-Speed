package anibt

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestQBTSyncDeltaAndStructuredAdd(t *testing.T) {
	c := testConfig(t)
	h := strings.Repeat("a", 40)
	syncs := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Error("API key authentication absent")
		}
		switch r.URL.Path {
		case "/api/v2/sync/maindata":
			syncs++
			if syncs == 1 {
				fmt.Fprintf(w, `{"rid":1,"full_update":true,"torrents":{"%s":{"name":"first","state":"stoppedUP","save_path":"/media/AniBT","progress":1}},"server_state":{"alltime_ul":100},"categories":{"AniBT":{}}}`, h)
			} else {
				if r.URL.Query().Get("rid") != "1" {
					t.Error("delta rid not used")
				}
				fmt.Fprintf(w, `{"rid":2,"torrents":{"%s":{"state":"uploading","upspeed":123}}}`, h)
			}
		case "/api/v2/torrents/add":
			fmt.Fprintf(w, `{"success_count":1,"failure_count":0,"pending_count":0,"added_torrent_ids":["%s"]}`, h)
		default:
			t.Error("unexpected endpoint", r.URL.Path)
		}
	}))
	defer server.Close()
	c.QBTURL = server.URL
	q := NewQBT(c, false)
	first, e := q.Snapshot(t.Context())
	must(t, e)
	second, e := q.Snapshot(t.Context())
	must(t, e)
	if first.Torrents[h].State != "stoppedUP" || second.Torrents[h].State != "uploading" || second.Torrents[h].Name != "first" {
		t.Fatal("snapshot alias or lost delta fields")
	}
	must(t, q.Add(t.Context(), Download{Hash: h, URL: "magnet:test"}))
	if q.Full != 1 || q.Delta != 1 {
		t.Fatal(q.Full, q.Delta)
	}
}
func TestQBTRejectsWrongAckAndNeverMutatesReadonly(t *testing.T) {
	c := testConfig(t)
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		fmt.Fprint(w, `{"success_count":1,"failure_count":0,"added_torrent_ids":["other"]}`)
	}))
	defer server.Close()
	c.QBTURL = server.URL
	q := NewQBT(c, false)
	if q.Add(t.Context(), Download{Hash: strings.Repeat("a", 40)}) == nil {
		t.Fatal("wrong hash accepted")
	}
	q.ReadOnly = true
	if q.Execute(t.Context(), Command{Kind: "archive", Hashes: []string{"x"}}) == nil || calls != 1 {
		t.Fatal("preflight issued a mutation")
	}
}
func TestTorrentIdentityExactSpan(t *testing.T) {
	info := `d6:lengthi123e4:name1:x6:pieces20:aaaaaaaaaaaaaaaaaaaae`
	torrent := "d4:info" + info + "e"
	h, size, e := TorrentIdentity([]byte(torrent))
	must(t, e)
	want := sha1.Sum([]byte(info))
	if h != hex.EncodeToString(want[:]) || size != 123 {
		t.Fatal(h, size)
	}
	for _, bad := range []string{torrent + "junk", "d4:infod6:lengthi-1eee", "d4:infod6:lengthi01eee", "d4:infoi1ee", "ll", "999999999999999999999:x"} {
		if _, _, e := TorrentIdentity([]byte(bad)); e == nil {
			t.Fatal("bad bencode accepted", bad)
		}
	}
}
func FuzzTorrentNeverPanics(f *testing.F) {
	for _, s := range []string{"d4:infod6:lengthi1eee", "i1e", "d", "", "999:x"} {
		f.Add([]byte(s))
	}
	f.Fuzz(func(t *testing.T, b []byte) {
		if len(b) > 8<<20 {
			return
		}
		TorrentIdentity(b)
	})
}

func TestQBTArchiveIsTheOnlyRemovalAndNeverDeletesFiles(t *testing.T) {
	c := testConfig(t)
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		r.ParseForm()
		if r.URL.Path != "/api/v2/torrents/delete" || r.Form.Get("deleteFiles") != "false" {
			t.Error("destructive removal request", r.URL.Path, r.Form)
		}
	}))
	defer server.Close()
	c.QBTURL = server.URL
	q := NewQBT(c, false)
	if q.Execute(t.Context(), Command{Kind: "delete", Hashes: []string{strings.Repeat("a", 40)}}) == nil || calls != 0 {
		t.Fatal("obsolete destructive command accepted")
	}
	must(t, q.Execute(t.Context(), Command{Kind: "archive", Hashes: []string{strings.Repeat("a", 40)}}))
	if calls != 1 {
		t.Fatal(calls)
	}
}
