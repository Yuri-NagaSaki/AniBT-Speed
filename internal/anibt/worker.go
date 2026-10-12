package anibt

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

var Revision = "development"

const Version = "2.0.0"

// Settlement writes only a retry result, never the cancelled operation's result.
// It is synchronous and bounded; shutdown waits for it before releasing flock.
func settle(fn func(context.Context) error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if e := fn(ctx); e != nil && !errors.Is(e, ErrStale) {
		slog.Error("task settlement failed", "error", e)
	}
}
func Lock(dir string) (*os.File, error) {
	if e := os.MkdirAll(dir, 0700); e != nil {
		return nil, e
	}
	f, e := os.OpenFile(filepath.Join(dir, "worker.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	if e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		f.Close()
		return nil, fmt.Errorf("another AniBT process owns the state directory")
	}
	return f, nil
}
func atomicJSON(file string, v any) error {
	b, e := json.MarshalIndent(v, "", "  ")
	if e != nil {
		return e
	}
	f, e := os.OpenFile(file+".tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	if _, e = f.Write(b); e != nil {
		f.Close()
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	return os.Rename(file+".tmp", file)
}
func sdNotify(message string) {
	addr := os.Getenv("NOTIFY_SOCKET")
	if addr == "" {
		return
	}
	c, e := net.Dial("unixgram", addr)
	if e == nil {
		defer c.Close()
		_, _ = c.Write([]byte(message))
	}
}

type JobState struct {
	Runs        int     `json:"runs"`
	Failures    int     `json:"failures"`
	Consecutive int     `json:"consecutive_failures"`
	Running     bool    `json:"running"`
	LastSuccess int64   `json:"last_success"`
	LastStarted int64   `json:"last_started"`
	Duration    float64 `json:"duration_seconds"`
	Error       string  `json:"error,omitempty"`
}
type Worker struct {
	c          Config
	s          *Store
	controller *Controller
	mu         sync.Mutex
	jobs       map[string]JobState
	stage      string
	started    int64
}

func (w *Worker) loop(ctx context.Context, wg *sync.WaitGroup, name string, interval, budget time.Duration, fn func(context.Context) error) {
	wg.Go(func() {
		for ctx.Err() == nil {
			started := time.Now()
			w.mu.Lock()
			st := w.jobs[name]
			st.Runs++
			st.Running = true
			st.LastStarted = started.Unix()
			w.jobs[name] = st
			w.mu.Unlock()
			jobCtx, cancel := context.WithTimeout(ctx, budget)
			e := fn(jobCtx)
			cancel()
			w.mu.Lock()
			st = w.jobs[name]
			st.Running = false
			st.Duration = time.Since(started).Seconds()
			if e != nil {
				st.Error = e.Error()
				st.Failures++
				st.Consecutive++
			} else {
				st.LastSuccess = time.Now().Unix()
				st.Error = ""
				st.Consecutive = 0
			}
			w.jobs[name] = st
			w.mu.Unlock()
			if ctx.Err() != nil {
				return
			}
			delay := max(time.Second, interval-time.Since(started))
			if e != nil {
				delay = min(5*time.Minute, interval*time.Duration(1<<min(st.Consecutive, 8)))
				delay = max(delay, retryDelay(e))
				slog.Warn("lane deferred", "lane", name, "error", e)
			}
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
		}
	})
}
func (w *Worker) status(ctx context.Context) map[string]any {
	w.mu.Lock()
	jobs := map[string]JobState{}
	stage := w.stage
	for k, v := range w.jobs {
		jobs[k] = v
	}
	w.mu.Unlock()
	state := stage
	if stage == "running" {
		state = "ok"
		control := jobs["control"]
		if control.LastSuccess == 0 {
			state = "starting"
		}
		if control.Error != "" || (control.LastSuccess > 0 && time.Duration(time.Now().Unix()-control.LastSuccess)*time.Second > max(3*w.c.ControlInterval, 3*time.Minute)) {
			state = "degraded"
		}
		for _, job := range jobs {
			if job.Error != "" {
				state = "degraded"
			}
		}
	}
	stats, e := w.s.Stats(ctx)
	if e != nil {
		state = "degraded"
	}
	return map[string]any{"version": Version, "revision": Revision, "pid": os.Getpid(), "started_at": w.started, "updated_at": time.Now().Unix(), "status": state, "jobs": jobs, "qbt": w.controller.Summary(), "work": stats}
}
func preflight(ctx context.Context, c Config, dependencies bool) (Snapshot, error) {
	if e := c.Validate(); e != nil {
		return Snapshot{}, e
	}
	if st, e := os.Stat(c.MediaRoot); e != nil || !st.IsDir() {
		return Snapshot{}, fmt.Errorf("media root unavailable")
	}
	if c.Media {
		for _, command := range []string{"mediainfo", "nice", "ionice", "prlimit"} {
			if _, e := exec.LookPath(command); e != nil {
				return Snapshot{}, fmt.Errorf("required executable missing: %s", command)
			}
		}
		cmd := exec.CommandContext(ctx, "mediainfo", "--Version")
		if e := cmd.Run(); e != nil {
			return Snapshot{}, fmt.Errorf("MediaInfo executable unusable")
		}
	}
	q := NewQBT(c, true)
	snap, e := q.Snapshot(ctx)
	if e != nil {
		return Snapshot{}, e
	}
	if _, ok := snap.Server["alltime_ul"]; !ok {
		return Snapshot{}, fmt.Errorf("qB traffic counters unavailable")
	}
	if dependencies && c.Feeds {
		f := NewFeeds(c, nil)
		b, _, _, e := f.fetch(ctx, strings.TrimRight(c.APIRoot, "/")+"/api/subtitle-groups", nil)
		if e != nil {
			return Snapshot{}, e
		}
		var d struct{ Data []struct{ Slug, Name string } }
		if json.Unmarshal(b, &d) != nil || len(d.Data) == 0 {
			return Snapshot{}, fmt.Errorf("invalid AniBT group directory")
		}
	}
	if dependencies && c.Notify {
		n := NewNotifier(c, nil)
		b, _, _, e := request(ctx, n.http, "Telegram", "GET", n.base+"/bot"+c.NotifyToken+"/getMe", nil, nil, 1<<20)
		if e != nil {
			return Snapshot{}, e
		}
		var ack struct{ OK bool }
		if json.Unmarshal(b, &ack) != nil || !ack.OK {
			return Snapshot{}, fmt.Errorf("Telegram credentials rejected")
		}
	}
	return snap, nil
}
func Run(ctx context.Context, c Config, activation string) error {
	lock, e := Lock(c.StateDir)
	if e != nil {
		return e
	}
	defer lock.Close()
	s, e := OpenStore(filepath.Join(c.StateDir, "state.sqlite3"), c.Notify, c.MaxAttempts)
	if e != nil {
		return e
	}
	defer s.Close()
	if e = s.Recover(ctx); e != nil {
		return e
	}
	preCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	snap, e := preflight(preCtx, c, false)
	cancel()
	if e != nil {
		return e
	}
	controller := NewController(c, s, NewQBT(c, false))
	controller.publish(snap)
	w := &Worker{c: c, s: s, controller: controller, jobs: map[string]JobState{}, stage: "ready", started: time.Now().Unix()}
	if e = atomicJSON(filepath.Join(c.StateDir, "status.json"), w.status(ctx)); e != nil {
		return e
	}
	sdNotify("READY=1\nSTATUS=Preflight passed; waiting for activation")
	for activation != "" {
		b, e := os.ReadFile(activation)
		if e == nil && strings.TrimSpace(string(b)) == Revision {
			break
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(time.Second):
			if e = atomicJSON(filepath.Join(c.StateDir, "status.json"), w.status(ctx)); e != nil {
				return e
			}
			sdNotify("WATCHDOG=1")
		}
	}
	// Deployment rollback uses this durable marker to distinguish a preflight-only
	// startup from a worker that may have issued irreversible external effects.
	marker := filepath.Join(c.StateDir, "effects-"+Revision)
	if e = durableMarker(marker, []byte(time.Now().UTC().Format(time.RFC3339))); e != nil {
		return e
	}
	w.stage = "running"
	slog.Info("AniBT worker active", "revision", Revision)
	sdNotify("STATUS=Worker active")
	runCtx, stop := context.WithCancel(ctx)
	defer stop()
	var wg sync.WaitGroup
	w.loop(runCtx, &wg, "control", c.ControlInterval, c.ControlBudget, controller.Cycle)
	if c.Feeds {
		feeds := NewFeeds(c, s)
		w.loop(runCtx, &wg, "feeds", c.FeedInterval, 4*time.Minute, feeds.Poll)
		w.loop(runCtx, &wg, "prepare", 5*time.Second, 2*time.Minute, feeds.Prepare)
	}
	if c.Media {
		media := NewMedia(c, s)
		w.loop(runCtx, &wg, "media", c.MediaInterval, c.MediaTimeout+20*time.Second, media.Step)
	}
	if c.Notify {
		n := NewNotifier(c, s)
		w.loop(runCtx, &wg, "notifications", 2*time.Second, 10*time.Second, n.Step)
	}
	w.loop(runCtx, &wg, "maintenance", time.Minute, 15*time.Second, func(cx context.Context) error {
		if e := s.Maintain(cx, c, len(snap.Torrents)); e != nil {
			return e
		}
		summary := controller.Summary()
		count, _ := summary["torrents"].(int)
		return s.Summary(cx, c, count)
	})
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	running := true
	for running {
		select {
		case <-ctx.Done():
			running = false
		case <-ticker.C:
			if e = atomicJSON(filepath.Join(c.StateDir, "status.json"), w.status(runCtx)); e != nil {
				running = false
				stop()
			} else {
				sdNotify("WATCHDOG=1")
			}
		}
	}
	stop()
	wg.Wait()
	w.mu.Lock()
	w.stage = "stopped"
	w.mu.Unlock()
	settle(func(cx context.Context) error {
		return atomicJSON(filepath.Join(c.StateDir, "status.json"), w.status(cx))
	})
	return e
}

func Preflight(ctx context.Context, c Config) (Snapshot, error) { return preflight(ctx, c, true) }

// This must reach stable storage before any external mutation can be issued.
func durableMarker(path string, data []byte) error {
	f, e := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	if _, e = f.Write(data); e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e != nil {
		return e
	}
	if closeErr != nil {
		return closeErr
	}
	dir, e := os.Open(filepath.Dir(path))
	if e != nil {
		return e
	}
	defer dir.Close()
	return dir.Sync()
}
