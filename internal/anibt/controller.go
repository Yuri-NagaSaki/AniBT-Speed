package anibt

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"syscall"
	"time"
)

type Controller struct {
	c                         Config
	s                         *Store
	q                         *QBT
	previous                  map[string]Torrent
	lastArchive, lastRotation time.Time
	cursor                    int
	mu                        sync.Mutex
	summary                   map[string]any
}

func NewController(c Config, s *Store, q *QBT) *Controller {
	return &Controller{c: c, s: s, q: q, summary: map[string]any{}}
}
func (c *Controller) Summary() map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := map[string]any{}
	for k, v := range c.summary {
		out[k] = v
	}
	return out
}
func (c *Controller) publish(snap Snapshot) {
	states := map[string]int{}
	for _, t := range snap.Torrents {
		states[t.State]++
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.summary = map[string]any{"observed_at": snap.At, "torrents": len(snap.Torrents), "states": states, "upload_bytes_per_second": snap.Server["up_info_speed"], "download_bytes_per_second": snap.Server["dl_info_speed"], "http_requests": c.q.Requests, "http_failures": c.q.Failures, "response_bytes": c.q.Bytes, "full_updates": c.q.Full, "delta_updates": c.q.Delta, "storage_pressure": pressure(c.c, snap), "intake_paused": pressure(c.c, snap)}
}
func pressure(c Config, s Snapshot) bool {
	var st syscall.Statfs_t
	free, ok := s.Server["free_space_on_disk"]
	reserve := c.MinFreeGiB * (1 << 30)
	if syscall.Statfs(c.MediaRoot, &st) == nil {
		localFree := float64(st.Bavail) * float64(st.Bsize)
		if !ok || localFree < free {
			free = localFree
		}
		ok = true
		reserve = max(reserve, float64(st.Blocks)*float64(st.Bsize)*(1-c.MaxDiskPercent/100))
	}
	return ok && free < reserve
}
func (c *Controller) Cycle(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, c.c.ControlBudget)
	defer cancel()
	snap, e := c.q.Snapshot(ctx)
	if e != nil {
		return e
	}
	defer func() { c.publish(snap) }()
	ex, e := c.s.Observe(ctx, snap, c.previous, c.c)
	if e != nil {
		return e
	}
	c.previous = snap.Torrents
	downloads, e := c.s.Downloads(ctx)
	if e != nil {
		return e
	}
	for _, t := range downloads {
		if e = c.s.ReconcileDownload(ctx, t, snap.Torrents, c.c); e != nil {
			return e
		}
	}
	if e = c.reconcileArchives(ctx, snap); e != nil {
		return e
	}
	if !c.c.Archive || c.c.ArchiveBatch == 0 || c.c.ArchiveAfterDays == 0 {
		if _, e := c.s.db.ExecContext(ctx, "DELETE FROM tasks WHERE lane='archive' AND phase<>'verifying'"); e != nil {
			return e
		}
	}
	storagePressure := pressure(c.c, snap)
	if time.Since(c.lastArchive) >= c.c.ArchiveInterval {
		for _, t := range PlanArchive(snap.Torrents, c.c, snap.At) {
			if e = c.s.Enqueue(ctx, "archive", t.Hash, "ready", "torrent:"+t.Hash, ArchiveWork{Hash: t.Hash}); e != nil {
				return e
			}
		}
		c.lastArchive = time.Now()
	}
	start := c.q.Requests
	rotate := time.Since(c.lastRotation) >= c.c.RotationInterval
	if c.c.Rate {
		commands, e := c.rate(ctx, snap)
		if e != nil {
			return e
		}
		for _, cmd := range commands {
			if c.q.Requests-start >= int64(c.c.Commands) {
				break
			}
			if e = c.q.Execute(ctx, cmd); e != nil {
				return e
			}
		}
	}
	queueTorrents, e := c.s.WithoutArchiving(ctx, snap.Torrents)
	if e != nil {
		return e
	}
	for _, cmd := range PlanQueue(queueTorrents, c.c, ex, snap.At, rotate) {
		if c.q.Requests-start >= int64(c.c.Commands) {
			break
		}
		if e = c.q.Execute(ctx, cmd); e != nil {
			return e
		}
		if cmd.Kind == "stop" && rotate {
			c.lastRotation = time.Now()
		}
	}
	// One operation per class on each pass. Each HTTP call counts against the
	// same budget, including manifests and deletion revalidation.
	phases := []string{"download", "archive", "manifest"}
	phases = append(phases[c.cursor:], phases[:c.cursor]...)
	c.cursor = (c.cursor + 1) % 3
	added, archived := 0, 0
	for c.q.Requests-start < int64(c.c.Commands) {
		worked := false
		for _, phase := range phases {
			left := c.c.Commands - int(c.q.Requests-start)
			if left <= 0 {
				break
			}
			var did bool
			switch phase {
			case "download":
				if !storagePressure && added < c.c.AddBatch {
					did, e = c.admit(ctx, snap, left)
					if did {
						added++
					}
				}
			case "archive":
				if left >= 4 && archived < c.c.ArchiveBatch {
					did, e = c.archive(ctx)
					if did {
						archived++
					}
				}
			case "manifest":
				if c.c.Media {
					did, e = c.manifest(ctx, snap)
				}
			}
			if e != nil {
				return e
			}
			worked = worked || did
		}
		if !worked {
			break
		}
	}
	return nil
}
func (c *Controller) admit(ctx context.Context, snap Snapshot, left int) (bool, error) {
	if !snap.Categories[c.c.Category] {
		if left < 2 {
			return false, nil
		}
		if e := c.q.Execute(ctx, Command{Kind: "category"}); e != nil {
			return false, e
		}
		snap.Categories[c.c.Category] = true
	}
	t, e := c.s.Claim(ctx, "download", []string{"ready"}, time.Minute)
	if e != nil || t == nil {
		return false, e
	}
	var d Download
	if e = json.Unmarshal(t.Data, &d); e != nil {
		settle(func(cx context.Context) error {
			return c.s.Retry(cx, *t, fmt.Errorf("invalid prepared download"), time.Hour)
		})
		return true, nil
	}
	if c.c.excluded(d.Slug) || (c.c.FeedMaxAge > 0 && d.Published > 0 && snap.At-d.Published > int64(c.c.FeedMaxAge/time.Second)) {
		return true, c.s.Finish(ctx, *t, "release", d.Key, "admission policy", "")
	}
	if _, exists := snap.Torrents[d.Hash]; exists {
		return true, c.s.Transition(ctx, *t, "ready", t.Resource, d, time.Minute)
	}
	if e = c.s.Submitting(ctx, *t, d); e != nil {
		return true, e
	}
	if e = c.q.Add(ctx, d); e != nil {
		return true, e
	}
	return true, nil
}
func (c *Controller) manifest(ctx context.Context, snap Snapshot) (bool, error) {
	t, e := c.s.Claim(ctx, "media", []string{"manifest"}, time.Minute)
	if e != nil || t == nil {
		return false, e
	}
	torrent, ok := snap.Torrents[t.Key]
	if !ok {
		archived, err := c.s.ArchivedMedia(ctx, t.Key)
		if err == nil {
			return true, c.s.Transition(ctx, *t, "extract", t.Resource, archived, 0)
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return true, err
		}
	}
	if !ok || !torrent.Managed(c.c) || !torrent.Complete() {
		e = fmt.Errorf("torrent unavailable for media manifest")
		settle(func(cx context.Context) error { return c.s.Retry(cx, *t, e, 5*time.Minute) })
		return true, nil
	}
	files, e := c.q.Files(ctx, t.Key)
	if e != nil {
		settle(func(cx context.Context) error { return c.s.Retry(cx, *t, e, time.Minute) })
		return true, e
	}
	w := MediaWork{Hash: t.Key, Name: torrent.Name, SavePath: torrent.SavePath, Files: files}
	return true, c.s.Transition(ctx, *t, "extract", t.Resource, w, 0)
}
func (c *Controller) rate(ctx context.Context, snap Snapshot) ([]Command, error) {
	upload := c.c.UploadMiB
	download := 0.0
	if snap.Server["dl_info_speed"] > 10240 {
		upload = c.c.BusyUploadMiB
		download = c.c.DownloadMiB
	}
	u, d := int64(upload*(1<<20)), int64(download*(1<<20))
	for _, window := range []struct {
		span  time.Duration
		limit float64
	}{{time.Hour, c.c.HourlyGiB}, {24 * time.Hour, c.c.DailyGiB}} {
		if window.limit <= 0 {
			continue
		}
		w, e := c.s.Traffic(ctx, snap.At, window.span)
		if e != nil {
			return nil, e
		}
		if w.Uploaded >= window.limit*(1<<30) {
			u, d = 1024, 1024
		}
	}
	var out []Command
	if snap.Server["up_rate_limit"] != float64(u) {
		out = append(out, Command{Kind: "upload", Limit: u})
	}
	if snap.Server["dl_rate_limit"] != float64(d) {
		out = append(out, Command{Kind: "download", Limit: d})
	}
	return out, nil
}
