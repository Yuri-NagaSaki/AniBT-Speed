package anibt

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

func (s *Store) WithoutArchiving(ctx context.Context, torrents map[string]Torrent) (map[string]Torrent, error) {
	rows, e := s.db.QueryContext(ctx, "SELECT key FROM tasks WHERE lane='archive' AND phase<>'blocked'")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	excluded := map[string]bool{}
	for rows.Next() {
		var hash string
		if e = rows.Scan(&hash); e != nil {
			return nil, e
		}
		excluded[hash] = true
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	out := make(map[string]Torrent, len(torrents))
	for hash, t := range torrents {
		if !excluded[hash] {
			out[hash] = t
		}
	}
	return out, nil
}
func (c *Controller) reconcileArchives(ctx context.Context, snap Snapshot) error {
	for i := 0; i < max(1, c.c.ArchiveBatch); i++ {
		task, e := c.s.Claim(ctx, "archive", []string{"verifying"}, time.Minute)
		if e != nil {
			return e
		}
		if task == nil {
			return nil
		}
		t := *task
		var w ArchiveWork
		if json.Unmarshal(t.Data, &w) != nil || w.Hash != t.Key {
			settle(func(cx context.Context) error {
				return c.s.Retry(cx, t, fmt.Errorf("invalid archive verification data"), time.Minute)
			})
			continue
		}
		if _, exists := snap.Torrents[t.Key]; exists {
			if snap.At-w.Requested < 120 {
				if e = c.s.Transition(ctx, t, "verifying", t.Resource, w, c.c.ControlInterval); e != nil {
					return e
				}
				continue
			}
			phase := "ready"
			if w.Submissions >= c.c.MaxAttempts {
				phase = "blocked"
			}
			e = c.s.tx(ctx, func(tx *sql.Tx) error {
				if e := claimValid(ctx, tx, t); e != nil {
					return e
				}
				if _, e := tx.ExecContext(ctx, "UPDATE tasks SET phase=?,attempts=attempts+1,due=?,updated=?,error='archive removal not yet observed',token='',lease=0 WHERE id=?", phase, snap.At+60, snap.At, t.ID); e != nil {
					return e
				}
				if phase == "blocked" {
					if e := c.s.event(ctx, tx, "blocked:"+t.ID+":"+fmt.Sprint(w.Submissions), "blocked", "AniBT 归档未被 qB 确认，已暂停重试："+w.Name, snap.At); e != nil {
						return e
					}
				}
				return releaseOwner(ctx, tx, t)
			})
			if e != nil {
				return e
			}
			continue
		}
		if e = verifyArchiveFiles(ctx, c.c, w); e != nil {
			// Absence in qB is insufficient: no archive receipt until the local files
			// pass verification. Operator retry must retain this manifest and phase.
			settle(func(cx context.Context) error { return c.s.Retry(cx, t, e, time.Minute) })
			if ctx.Err() != nil {
				return ctx.Err()
			}
			continue
		}
		if e = c.s.CompleteArchive(ctx, t, w, c.c.Media, snap.At); e != nil {
			return e
		}
	}
	return nil
}
func (s *Store) CompleteArchive(ctx context.Context, t Task, w ArchiveWork, media bool, now int64) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if e := claimValid(ctx, tx, t); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, `INSERT INTO archives VALUES(?,?,?,?,?) ON CONFLICT(hash) DO UPDATE SET name=excluded.name,save_path=excluded.save_path,files=excluded.files,archived_at=excluded.archived_at`, w.Hash, w.Name, w.SavePath, encode(w.Files), now); e != nil {
			return e
		}
		if e := receipt(ctx, tx, "content", w.Hash, "archived", now); e != nil {
			return e
		}
		if e := receipt(ctx, tx, "archive", w.Hash, "files retained", now); e != nil {
			return e
		}
		var done int
		if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM receipts WHERE kind='media' AND key=?", w.Hash).Scan(&done); e != nil {
			return e
		}
		if media && done == 0 {
			if e := putTask(ctx, tx, "media", w.Hash, "extract", t.Resource, MediaWork{Hash: w.Hash, Name: w.Name, SavePath: w.SavePath, Files: w.Files}, now); e != nil {
				return e
			}
		}
		// Only unfinished manifests depend on qB. Extract/upload jobs and blocked
		// item diagnostics remain durable and can operate on retained local files.
		if _, e := tx.ExecContext(ctx, `UPDATE tasks SET phase='extract',data=?,revision=revision+1,attempts=0,due=0,error='',token='',lease=0,updated=? WHERE lane='media' AND key=? AND phase='manifest'`, encode(MediaWork{Hash: w.Hash, Name: w.Name, SavePath: w.SavePath, Files: w.Files}), now, w.Hash); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, "DELETE FROM tasks WHERE id=?", t.ID); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, "DELETE FROM exposures WHERE hash=?", w.Hash); e != nil {
			return e
		}
		if e := s.event(ctx, tx, "archive:"+w.Hash+":"+fmt.Sprint(now), "archive", "AniBT 已归档："+w.Name+"；已结束做种并移除 qB 任务，文件保留在 "+w.SavePath, now); e != nil {
			return e
		}
		return releaseOwner(ctx, tx, t)
	})
}
func (s *Store) ArchivedMedia(ctx context.Context, hash string) (MediaWork, error) {
	var w MediaWork
	var raw []byte
	w.Hash = hash
	e := s.db.QueryRowContext(ctx, "SELECT name,save_path,files FROM archives WHERE hash=?", hash).Scan(&w.Name, &w.SavePath, &raw)
	if e != nil {
		return w, e
	}
	e = json.Unmarshal(raw, &w.Files)
	return w, e
}

type ArchiveRecord struct {
	Hash       string `json:"hash"`
	Name       string `json:"name"`
	SavePath   string `json:"save_path"`
	ArchivedAt int64  `json:"archived_at"`
}

func (s *Store) Archives(ctx context.Context) ([]ArchiveRecord, error) {
	rows, e := s.db.QueryContext(ctx, "SELECT hash,name,save_path,archived_at FROM archives ORDER BY archived_at DESC,hash LIMIT 200")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []ArchiveRecord{}
	for rows.Next() {
		var r ArchiveRecord
		if e = rows.Scan(&r.Hash, &r.Name, &r.SavePath, &r.ArchivedAt); e != nil {
			return nil, e
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
