package anibt

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

func (c *Controller) reconcileCleanup(ctx context.Context, snap Snapshot) error {
	rows, e := c.s.db.QueryContext(ctx, "SELECT "+taskColumns+" FROM tasks WHERE lane='cleanup' AND phase='verifying'")
	if e != nil {
		return e
	}
	var tasks []Task
	for rows.Next() {
		t, e := scanTask(rows)
		if e != nil {
			rows.Close()
			return e
		}
		tasks = append(tasks, t)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, t := range tasks {
		var w CleanupWork
		if e = json.Unmarshal(t.Data, &w); e != nil {
			return e
		}
		_, exists := snap.Torrents[t.Key]
		if exists && snap.At-w.Requested < 120 {
			continue
		}
		e = c.s.tx(ctx, func(tx *sql.Tx) error {
			if exists {
				phase := "ready"
				if w.Submissions >= c.c.MaxAttempts {
					phase = "blocked"
					if e := c.s.event(ctx, tx, "blocked:"+t.ID+":"+fmt.Sprint(t.Revision), "blocked", "AniBT 清理未被 qB 确认，已暂停重试："+t.Key, snap.At); e != nil {
						return e
					}
				}
				_, e := tx.ExecContext(ctx, "UPDATE tasks SET phase=?,attempts=attempts+1,due=?,updated=?,error='delete not yet observed' WHERE id=?", phase, snap.At+60, snap.At, t.ID)
				return e
			}
			// All media writers are fenced; keep an existing successful receipt intact.
			if _, e := tx.ExecContext(ctx, "DELETE FROM tasks WHERE id IN (?,?)", t.ID, "media:"+t.Key); e != nil {
				return e
			}
			if _, e := tx.ExecContext(ctx, "DELETE FROM owners WHERE resource=?", t.Resource); e != nil {
				return e
			}
			if _, e := tx.ExecContext(ctx, "INSERT OR IGNORE INTO receipts VALUES('media',?,'removed',?)", t.Key, snap.At); e != nil {
				return e
			}
			if e := receipt(ctx, tx, "content", t.Key, "removed", snap.At); e != nil {
				return e
			}
			return c.s.event(ctx, tx, "cleanup:"+t.Key, "cleanup", "AniBT 清理已确认："+t.Key, time.Now().Unix())
		})
		if e != nil {
			return e
		}
	}
	return nil
}
