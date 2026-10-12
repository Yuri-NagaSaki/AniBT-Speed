package anibt

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// Observe only probes current hashes and changed states. Successful receipts never
// enter a hot-path scan, and exposures contain current inventory only.
func (s *Store) Observe(ctx context.Context, snap Snapshot, previous map[string]Torrent, c Config) (map[string]Exposure, error) {
	exposures := map[string]Exposure{}
	e := s.tx(ctx, func(tx *sql.Tx) error {
		if previous == nil {
			if _, e := tx.ExecContext(ctx, "CREATE TEMP TABLE IF NOT EXISTS current_hashes(hash TEXT PRIMARY KEY)"); e != nil {
				return e
			}
			if _, e := tx.ExecContext(ctx, "DELETE FROM current_hashes"); e != nil {
				return e
			}
			stmt, e := tx.PrepareContext(ctx, "INSERT INTO current_hashes VALUES(?)")
			if e != nil {
				return e
			}
			for h := range snap.Torrents {
				if _, e = stmt.ExecContext(ctx, h); e != nil {
					stmt.Close()
					return e
				}
			}
			stmt.Close()
			if _, e = tx.ExecContext(ctx, "DELETE FROM exposures WHERE hash NOT IN (SELECT hash FROM current_hashes)"); e != nil {
				return e
			}
		}
		for h, old := range previous {
			if _, ok := snap.Torrents[h]; !ok {
				if _, e := tx.ExecContext(ctx, "DELETE FROM exposures WHERE hash=?", old.Hash); e != nil {
					return e
				}
			}
		}
		for h, t := range snap.Torrents {
			old, known := previous[h]
			if !known && t.Managed(c) {
				if _, e := tx.ExecContext(ctx, "INSERT OR IGNORE INTO receipts VALUES('content',?,'observed',?)", h, snap.At); e != nil {
					return e
				}
			}
			if !known || old.Active() != t.Active() {
				var started int64
				if t.Active() {
					started = snap.At
				}
				if _, e := tx.ExecContext(ctx, `INSERT INTO exposures VALUES(?,?,?) ON CONFLICT(hash) DO UPDATE SET started=CASE WHEN excluded.started>0 THEN CASE WHEN exposures.started>0 THEN exposures.started ELSE excluded.started END ELSE 0 END,last=CASE WHEN excluded.started>0 AND exposures.started=0 THEN excluded.last ELSE exposures.last END`, h, started, started); e != nil {
					return e
				}
			}
			if c.Media && t.Managed(c) && t.Complete() && (!known || !old.Complete() || old.SavePath != t.SavePath || old.Category != t.Category || old.Tags != t.Tags) {
				var n int
				if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM receipts WHERE kind='media' AND key=?", h).Scan(&n); e != nil {
					return e
				}
				if n == 0 {
					if e := putTask(ctx, tx, "media", h, "manifest", "torrent:"+h, MediaWork{Hash: h, Name: t.Name, SavePath: t.SavePath}, snap.At); e != nil {
						return e
					}
					// Invalidate path-dependent samples, but retain the old resource
					// owner until its lease expires so an in-flight reader drains.
					if _, e := tx.ExecContext(ctx, `UPDATE tasks SET phase='manifest',data=?,revision=revision+1,attempts=0,due=0,error='',token='',lease=0,updated=? WHERE id=? AND phase IN ('manifest','extract','blocked') AND (json_extract(data,'$.save_path')<>? OR (? AND phase='blocked' AND json_extract(data,'$.payload') IS NULL))`, encode(MediaWork{Hash: h, Name: t.Name, SavePath: t.SavePath}), snap.At, "media:"+h, t.SavePath, known && !old.Complete()); e != nil {
						return e
					}

				}
			}
		}
		rows, e := tx.QueryContext(ctx, "SELECT hash,started,last FROM exposures")
		if e != nil {
			return e
		}
		for rows.Next() {
			var h string
			var v Exposure
			if e = rows.Scan(&h, &v.Started, &v.Last); e != nil {
				rows.Close()
				return e
			}
			exposures[h] = v
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		return recordTraffic(ctx, tx, snap, c)
	})
	return exposures, e
}

type counterSample struct{ At, Up, Down int64 }

func recordTraffic(ctx context.Context, tx *sql.Tx, snap Snapshot, c Config) error {
	up, ok := snap.Server["alltime_ul"]
	down, ok2 := snap.Server["alltime_dl"]
	if !ok || !ok2 {
		return nil
	}
	current := counterSample{snap.At, int64(up), int64(down)}
	var raw string
	e := tx.QueryRowContext(ctx, "SELECT value FROM meta WHERE key='traffic_counter'").Scan(&raw)
	if e != nil && e != sql.ErrNoRows {
		return e
	}
	if e == nil {
		var old counterSample
		if e = json.Unmarshal([]byte(raw), &old); e != nil {
			return e
		}
		if current.At > old.At {
			known := current.At-old.At <= int64(3*c.ControlInterval/time.Second) && current.Up >= old.Up && current.Down >= old.Down
			uploaded, downloaded := current.Up-old.Up, current.Down-old.Down
			if !known {
				uploaded = 0
				downloaded = 0
			}
			if _, e = tx.ExecContext(ctx, "INSERT INTO traffic VALUES(?,?,?,?,?)", old.At, current.At, uploaded, downloaded, known); e != nil {
				return e
			}
		}
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO meta VALUES('traffic_counter',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", string(encode(current)))
	return e
}

type TrafficWindow struct {
	Uploaded   float64 `json:"uploaded_bytes"`
	Downloaded float64 `json:"downloaded_bytes"`
	Coverage   float64 `json:"coverage_seconds"`
	Seconds    int64   `json:"window_seconds"`
}

func (s *Store) Traffic(ctx context.Context, now int64, span time.Duration) (TrafficWindow, error) {
	w := TrafficWindow{Seconds: int64(span / time.Second)}
	start := now - w.Seconds
	rows, e := s.db.QueryContext(ctx, "SELECT start,end,uploaded,downloaded,known FROM traffic WHERE end>? AND start<?", start, now)
	if e != nil {
		return w, e
	}
	defer rows.Close()
	for rows.Next() {
		var a, b, u, d int64
		var known bool
		if e = rows.Scan(&a, &b, &u, &d, &known); e != nil {
			return w, e
		}
		if !known || b <= a {
			continue
		}
		seconds := float64(max(0, min(now, b)-max(start, a)))
		fraction := seconds / float64(b-a)
		w.Uploaded += float64(u) * fraction
		w.Downloaded += float64(d) * fraction
		w.Coverage += seconds
	}
	return w, rows.Err()
}
func (s *Store) Maintain(ctx context.Context, c Config, torrents int) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		cutoff := time.Now().Add(-time.Duration(c.HistoryDays) * 24 * time.Hour).Unix()
		for _, query := range []string{"DELETE FROM events WHERE at<?", "DELETE FROM traffic WHERE end<?", "DELETE FROM rejected WHERE updated<?", "DELETE FROM sources WHERE updated<? AND NOT EXISTS(SELECT 1 FROM tasks WHERE lane='download' AND tasks.key=sources.key)"} {
			if _, e := tx.ExecContext(ctx, query, cutoff); e != nil {
				return e
			}
		}
		return nil
	})
}
func (s *Store) Summary(ctx context.Context, c Config, torrents int) error {
	if !c.Notify {
		return nil
	}
	zone, _ := time.LoadLocation(c.Timezone)
	now := time.Now().In(zone)
	if now.Hour() < c.SummaryHour {
		return nil
	}
	key := now.Format("2006-01-02")
	w, e := s.Traffic(ctx, now.Unix(), 24*time.Hour)
	if e != nil {
		return e
	}
	return s.tx(ctx, func(tx *sql.Tx) error {
		var n int
		if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM receipts WHERE kind='summary' AND key=?", key).Scan(&n); e != nil {
			return e
		}
		if n > 0 {
			return nil
		}
		return putTask(ctx, tx, "notify", "summary:"+key, "send", "notify:summary:"+key, Notification{Text: fmt.Sprintf("AniBT 最近 24 小时已观测上传 %.2f GiB；数据覆盖 %.1f%%；种子 %d", w.Uploaded/(1<<30), w.Coverage/864, torrents), Summary: key}, now.Unix())
	})
}
