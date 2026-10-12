package anibt

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func (s *Store) Operate(ctx context.Context, action, key string) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		now := time.Now().Unix()
		if action == "replay" {
			var raw []byte
			if e := tx.QueryRowContext(ctx, "SELECT data FROM sources WHERE key=?", key).Scan(&raw); e != nil {
				return fmt.Errorf("release source unavailable; historical receipts cannot be replayed without original metadata")
			}
			var d Download
			if json.Unmarshal(raw, &d) != nil {
				return fmt.Errorf("invalid release source")
			}
			var n int
			if e := tx.QueryRowContext(ctx, "SELECT count(*) FROM tasks WHERE key=? AND (lease>? OR phase IN ('submitted','tracking'))", key, now).Scan(&n); e != nil {
				return e
			}
			if n > 0 {
				return fmt.Errorf("release is claimed or needs qB reconciliation")
			}
			if _, e := tx.ExecContext(ctx, "DELETE FROM receipts WHERE kind='release' AND key=?", key); e != nil {
				return e
			}
			if _, e := tx.ExecContext(ctx, "DELETE FROM tasks WHERE lane='download' AND key=?", key); e != nil {
				return e
			}
			// Replay permission is consumed by Ready for this release; never remove a
			// permanent content receipt used by other aliases.
			if _, e := tx.ExecContext(ctx, "INSERT INTO meta VALUES(?, '1') ON CONFLICT(key) DO UPDATE SET value='1'", "replay:"+key); e != nil {
				return e
			}
			return putTask(ctx, tx, "download", key, "pending", "release:"+key, d, now)
		}
		t, e := scanTask(tx.QueryRowContext(ctx, "SELECT "+taskColumns+" FROM tasks WHERE id=?", key))
		if e != nil {
			return fmt.Errorf("task not found")
		}
		if t.Lease > now {
			return fmt.Errorf("task is currently claimed")
		}
		if t.Phase == "submitted" || (t.Lane == "cleanup" && t.Phase == "verifying") {
			return fmt.Errorf("external effect must be reconciled before operator changes")
		}
		if action == "cancel" {
			if _, e := tx.ExecContext(ctx, "DELETE FROM tasks WHERE id=?", key); e != nil {
				return e
			}
			if t.Lane == "download" {
				if e := receipt(ctx, tx, "release", t.Key, "operator cancelled", now); e != nil {
					return e
				}
			}
			if t.Lane == "media" {
				if e := receipt(ctx, tx, "media", t.Key, "operator cancelled", now); e != nil {
					return e
				}
			}
			return s.event(ctx, tx, "cancel:"+key+":"+fmt.Sprint(now), "operator", "AniBT 已取消任务："+key, now)
		}
		if action != "retry" {
			return fmt.Errorf("unknown operation")
		}
		phase := t.Phase
		if phase == "blocked" {
			switch t.Lane {
			case "download":
				var d Download
				if json.Unmarshal(t.Data, &d) != nil {
					return fmt.Errorf("invalid download task")
				}
				phase = "pending"
				if d.Observed > 0 {
					phase = "tracking"
				} else if d.Hash != "" {
					phase = "ready"
				}
			case "media":
				var m MediaWork
				if json.Unmarshal(t.Data, &m) != nil {
					return fmt.Errorf("invalid media task")
				}
				phase = "manifest"
				if len(m.Files) > 0 {
					phase = "extract"
				}
				if len(m.Payload) > 0 {
					phase = "upload"
				}
			case "cleanup":
				phase = "ready"
			case "notify":
				phase = "send"
			default:
				return fmt.Errorf("unknown task lane")
			}
		}
		if _, e = tx.ExecContext(ctx, "DELETE FROM owners WHERE token=?", t.Token); e != nil {
			return e
		}
		_, e = tx.ExecContext(ctx, "UPDATE tasks SET phase=?,attempts=0,due=0,error='',revision=revision+1,token='',lease=0,updated=? WHERE id=?", phase, now, key)
		return e
	})
}
func (s *Store) replayAllowed(ctx context.Context, tx *sql.Tx, key string) (bool, error) {
	var n int
	e := tx.QueryRowContext(ctx, "SELECT count(*) FROM meta WHERE key=?", "replay:"+key).Scan(&n)
	return n > 0, e
}
func validLane(lane string) bool {
	return strings.Contains("|download|media|cleanup|notify|", "|"+lane+"|")
}
