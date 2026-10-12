package anibt

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWorkerSingleOwnerAndGracefulShutdown(t *testing.T) {
	c := testConfig(t)
	c.Feeds = false
	c.Media = false
	c.Notify = false
	c.Pool = false
	c.Cleanup = false
	c.ControlInterval = time.Second
	c.ControlBudget = time.Second
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"rid":1,"full_update":true,"torrents":{},"server_state":{"alltime_ul":1,"alltime_dl":2}}`)
	}))
	defer server.Close()
	c.QBTURL = server.URL
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- Run(ctx, c, "") }()
	deadline := time.Now().Add(3 * time.Second)
	ready := false
	for time.Now().Before(deadline) {
		b, _ := os.ReadFile(filepath.Join(c.StateDir, "status.json"))
		var st struct{ Status string }
		json.Unmarshal(b, &st)
		if st.Status == "ready" || st.Status == "ok" {
			ready = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !ready {
		t.Fatal("worker never became ready")
	}
	if lock, e := Lock(c.StateDir); e == nil {
		lock.Close()
		t.Fatal("duplicate worker permitted")
	}
	cancel()
	select {
	case e := <-done:
		must(t, e)
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown did not drain tasks")
	}
	b, e := os.ReadFile(filepath.Join(c.StateDir, "status.json"))
	must(t, e)
	var st struct{ Status string }
	must(t, json.Unmarshal(b, &st))
	if st.Status != "stopped" {
		t.Fatal(string(b))
	}
	lock, e := Lock(c.StateDir)
	must(t, e)
	lock.Close()
}
func TestStrictConfiguration(t *testing.T) {
	c := testConfig(t)
	_ = c
	for _, value := range []string{"QBT_URL=http://localhost\n", "OBSOLETE_API_TOKEN=old\n", "ANIBT_UNKNOWN=true\n", "ANIBT_MEDIA_SAMPLES=0\n", "ANIBT_MIN_FREE_GIB=NaN\n", "ANIBT_CONTROL_INTERVAL=30\n"} {
		file := filepath.Join(t.TempDir(), "env")
		must(t, os.WriteFile(file, []byte(value), 0600))
		if _, e := LoadConfig(file); e == nil {
			t.Fatal("invalid config accepted", value)
		}
	}
}
