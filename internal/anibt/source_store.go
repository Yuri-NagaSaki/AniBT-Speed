package anibt

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

type Download struct {
	Submissions int     `json:"submissions,omitempty"`
	Key         string  `json:"key"`
	Slug        string  `json:"slug"`
	Title       string  `json:"title"`
	URL         string  `json:"url"`
	GroupName   string  `json:"group_name"`
	Anime       string  `json:"anime"`
	BgmID       string  `json:"bgm_id"`
	Published   int64   `json:"published"`
	Hash        string  `json:"hash,omitempty"`
	Content     []byte  `json:"content,omitempty"`
	SavePath    string  `json:"save_path,omitempty"`
	Tags        string  `json:"tags,omitempty"`
	Submitted   int64   `json:"submitted,omitempty"`
	Observed    int64   `json:"observed,omitempty"`
	Progress    float64 `json:"progress,omitempty"`
	ProgressAt  int64   `json:"progress_at,omitempty"`
	State       string  `json:"state,omitempty"`
}
type Feed struct {
	Slug, Name     string
	Initialized    bool
	ETag, Modified string
}
type Entry struct {
	Download
	Reject    string
	ScopeOnly bool
}

func (s *Store) SyncFeeds(ctx context.Context, groups map[string]string, c Config) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if len(groups) == 0 {
			return fmt.Errorf("empty group directory")
		}
		if _, e := tx.ExecContext(ctx, "UPDATE feeds SET enabled=0"); e != nil {
			return e
		}
		for slug, name := range groups {
			if _, e := tx.ExecContext(ctx, `INSERT INTO feeds(slug,name,enabled) VALUES(?,?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,enabled=excluded.enabled`, slug, name, !c.excluded(slug)); e != nil {
				return e
			}
		}
		return nil
	})
}
func (s *Store) Feeds(ctx context.Context) ([]Feed, error) {
	rows, e := s.db.QueryContext(ctx, "SELECT slug,name,initialized,etag,modified FROM feeds WHERE enabled=1 ORDER BY polled,slug")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Feed{}
	for rows.Next() {
		var f Feed
		if e = rows.Scan(&f.Slug, &f.Name, &f.Initialized, &f.ETag, &f.Modified); e != nil {
			return nil, e
		}
		out = append(out, f)
	}
	return out, rows.Err()
}
func (s *Store) FeedError(ctx context.Context, slug string, cause error) error {
	_, e := s.db.ExecContext(ctx, "UPDATE feeds SET polled=?,error=? WHERE slug=?", time.Now().Unix(), cause.Error(), slug)
	return e
}
func (s *Store) Ingest(ctx context.Context, f Feed, entries []Entry, etag, modified string, history bool) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		now := time.Now().Unix()
		for _, entry := range entries {
			d := entry.Download
			if entry.Reject != "" {
				if _, e := tx.ExecContext(ctx, `INSERT INTO rejected VALUES(?,?,?,?) ON CONFLICT(slug,key) DO UPDATE SET reason=excluded.reason,updated=excluded.updated`, f.Slug, d.Key, entry.Reject, now); e != nil {
					return e
				}
				continue
			}
			var n int
			if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM receipts WHERE kind='release' AND key=?", d.Key).Scan(&n); e != nil {
				return e
			}
			if n > 0 {
				continue
			}
			if history {
				if e := receipt(ctx, tx, "release", d.Key, "bootstrap", now); e != nil {
					return e
				}
				continue
			}
			raw := encode(d)
			sum := sha256.Sum256(raw)
			fingerprint := hex.EncodeToString(sum[:])
			var old string
			e := tx.QueryRowContext(ctx, "SELECT fingerprint FROM sources WHERE key=?", d.Key).Scan(&old)
			if e != nil && !errors.Is(e, sql.ErrNoRows) {
				return e
			}
			if fingerprint == old {
				continue
			}
			if _, e = tx.ExecContext(ctx, `INSERT INTO sources VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET slug=excluded.slug,fingerprint=excluded.fingerprint,data=excluded.data,updated=excluded.updated`, d.Key, d.Slug, fingerprint, raw, now); e != nil {
				return e
			}
			if e = putTask(ctx, tx, "download", d.Key, "pending", "release:"+d.Key, d, now); e != nil {
				return e
			}
			// Prepared artifacts and in-flight preparation claims belong to a source revision.
			// Submitted/tracking work is never overwritten before its old hash is reconciled.
			if _, e = tx.ExecContext(ctx, `DELETE FROM owners WHERE token IN (SELECT token FROM tasks WHERE id=? AND phase IN ('pending','ready','blocked'))`, "download:"+d.Key); e != nil {
				return e
			}
			if _, e = tx.ExecContext(ctx, `UPDATE tasks SET phase='pending',resource=?,data=?,revision=revision+1,attempts=0,due=0,error='',token='',lease=0,updated=? WHERE id=? AND phase IN ('pending','ready','blocked')`, "release:"+d.Key, raw, now, "download:"+d.Key); e != nil {
				return e
			}
		}
		_, e := tx.ExecContext(ctx, "UPDATE feeds SET initialized=1,etag=?,modified=?,polled=?,error='' WHERE slug=?", etag, modified, now, f.Slug)
		return e
	})
}
func (s *Store) Ready(ctx context.Context, t Task, d Download) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if e := claimValid(ctx, tx, t); e != nil {
			return e
		}
		var n int
		allowed, e := s.replayAllowed(ctx, tx, d.Key)
		if e != nil {
			return e
		}
		if !allowed {
			if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM receipts WHERE kind='content' AND key=?", d.Hash).Scan(&n); e != nil {
				return e
			}
		}
		if n == 0 {
			if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM tasks WHERE lane='download' AND id<>? AND resource=? AND phase IN ('ready','submitted','tracking')", t.ID, "torrent:"+d.Hash).Scan(&n); e != nil {
				return e
			}
		}
		if _, e := tx.ExecContext(ctx, "DELETE FROM meta WHERE key=?", "replay:"+d.Key); e != nil {
			return e
		}

		if n > 0 {
			if e := receipt(ctx, tx, "release", d.Key, "duplicate content", time.Now().Unix()); e != nil {
				return e
			}
			if _, e := tx.ExecContext(ctx, "DELETE FROM tasks WHERE id=?", t.ID); e != nil {
				return e
			}
		} else {
			if _, e := tx.ExecContext(ctx, "UPDATE tasks SET phase='ready',resource=?,data=?,revision=revision+1,attempts=0,due=0,error='',token='',lease=0,updated=? WHERE id=?", "torrent:"+d.Hash, encode(d), time.Now().Unix(), t.ID); e != nil {
				return e
			}
		}
		return releaseOwner(ctx, tx, t)
	})
}
func (s *Store) Downloads(ctx context.Context) ([]Task, error) {
	rows, e := s.db.QueryContext(ctx, "SELECT "+taskColumns+" FROM tasks WHERE lane='download' AND phase IN ('ready','submitted','tracking')")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	var ts []Task
	for rows.Next() {
		t, e := scanTask(rows)
		if e != nil {
			return nil, e
		}
		ts = append(ts, t)
	}
	return ts, rows.Err()
}
func (s *Store) ReconcileDownload(ctx context.Context, t Task, ts map[string]Torrent, c Config) error {
	var d Download
	if e := json.Unmarshal(t.Data, &d); e != nil {
		return e
	}
	now := time.Now().Unix()
	current, present := ts[d.Hash]
	return s.tx(ctx, func(tx *sql.Tx) error {
		var version int
		var lease int64
		if e := tx.QueryRowContext(ctx, "SELECT revision,lease FROM tasks WHERE id=?", t.ID).Scan(&version, &lease); e != nil {
			return e
		}
		if version != t.Revision || lease > now {
			return nil
		}
		if present {
			if t.Phase != "tracking" {
				d.Observed = now
				d.ProgressAt = now
				d.Content = nil
				if e := receipt(ctx, tx, "release", d.Key, "admitted", now); e != nil {
					return e
				}
				if e := receipt(ctx, tx, "content", d.Hash, "admitted", now); e != nil {
					return e
				}
				if t.Phase == "submitted" {
					if e := s.event(ctx, tx, "admitted:"+d.Key, "admitted", "AniBT 已加入下载："+d.Title, now); e != nil {
						return e
					}
				}
			}
			if current.Progress > d.Progress {
				d.ProgressAt = now
			}
			d.Progress = current.Progress
			if current.Complete() {
				if e := receipt(ctx, tx, "content", d.Hash, "completed", now); e != nil {
					return e
				}
				if t.Phase != "ready" && d.State != "imported" {
					if e := s.event(ctx, tx, "complete:"+d.Key, "completed", "AniBT 下载完成："+d.Title, now); e != nil {
						return e
					}
				}
				_, e := tx.ExecContext(ctx, "DELETE FROM tasks WHERE id=?", t.ID)
				return e
			}
			state := "downloading"
			if current.State == "missingFiles" || current.State == "error" {
				state = current.State
			} else if now-d.ProgressAt >= int64(c.StallTimeout/time.Second) {
				state = "stalled"
			}
			if state != d.State && state != "downloading" {
				if e := s.event(ctx, tx, "download-state:"+d.Key+":"+fmt.Sprint(now), "download_problem", "AniBT 下载异常："+d.Title+"（"+state+"）", now); e != nil {
					return e
				}
			}
			d.State = state
			_, e := tx.ExecContext(ctx, "UPDATE tasks SET phase='tracking',data=?,revision=revision+1,error=?,updated=? WHERE id=?", encode(d), map[bool]string{true: state}[state != "downloading"], now, t.ID)
			return e
		}
		if t.Phase == "submitted" && now-d.Submitted >= int64(c.ConfirmTimeout/time.Second) {
			// Reconcile absence before applying corrected upstream metadata.
			var raw []byte
			if e := tx.QueryRowContext(ctx, "SELECT data FROM sources WHERE key=?", d.Key).Scan(&raw); e != nil {
				return e
			}
			var latest Download
			if e := json.Unmarshal(raw, &latest); e != nil {
				return e
			}
			phase := "pending"
			latest.Submissions = d.Submissions
			raw = encode(latest)
			if d.Submissions >= c.MaxAttempts {
				phase = "blocked"
			}
			_, e := tx.ExecContext(ctx, "UPDATE tasks SET phase=?,resource=?,data=?,revision=revision+1,due=?,error='not observed after submission',updated=? WHERE id=?", phase, "release:"+d.Key, raw, now+60, now, t.ID)
			return e
		}
		if t.Phase == "tracking" {
			if e := s.event(ctx, tx, "missing:"+d.Key, "download_problem", "AniBT 下载任务已从 qB 消失："+d.Title, now); e != nil {
				return e
			}
			_, e := tx.ExecContext(ctx, "UPDATE tasks SET phase='blocked',error='torrent removed from qB',updated=? WHERE id=?", now, t.ID)
			return e
		}
		return nil
	})
}

// Persist the ambiguous side effect before sending the HTTP request; no timeout
// or restart may turn it into an immediate second submission.
func (s *Store) Submitting(ctx context.Context, t Task, d Download) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if e := claimValid(ctx, tx, t); e != nil {
			return e
		}
		d.Submitted = time.Now().Unix()
		d.Submissions++
		_, e := tx.ExecContext(ctx, "UPDATE tasks SET phase='submitted',data=?,revision=revision+1,attempts=attempts+1,updated=?,token='',lease=0 WHERE id=?", encode(d), d.Submitted, t.ID)
		if e != nil {
			return e
		}
		return releaseOwner(ctx, tx, t)
	})
}
