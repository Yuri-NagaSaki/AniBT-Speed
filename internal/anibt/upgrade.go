package anibt

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// UpgradeState is explicit and offline. Old destructive requests are never
// reinterpreted as archives: their outcomes must be reconciled before retirement.
func UpgradeState(ctx context.Context, c Config) error {
	lock, e := Lock(c.StateDir)
	if e != nil {
		return e
	}
	defer lock.Close()
	file := filepath.Join(c.StateDir, "state.sqlite3")
	if _, e = os.Stat(file); e != nil {
		return e
	}
	db, e := sql.Open("sqlite", file+"?_pragma=busy_timeout(2000)&_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)")
	if e != nil {
		return e
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	var version string
	if e = db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key='schema'").Scan(&version); e != nil {
		return e
	}
	if version == "3" {
		return nil
	}
	if version != "2" {
		return fmt.Errorf("upgrade-state requires schema 2")
	}
	rows, e := db.QueryContext(ctx, "SELECT "+taskColumns+" FROM tasks WHERE lane='cleanup'")
	if e != nil {
		return e
	}
	var old []Task
	for rows.Next() {
		t, e := scanTask(rows)
		if e != nil {
			rows.Close()
			return e
		}
		old = append(old, t)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	var snap Snapshot
	for _, t := range old {
		if t.Phase == "verifying" {
			snap, e = NewQBT(c, true).Snapshot(ctx)
			if e != nil {
				return e
			}
			break
		}
	}
	return (&Store{db: db}).tx(ctx, func(tx *sql.Tx) error {
		now := time.Now().Unix()
		for _, t := range old {
			outcome := "cancelled destructive cleanup during archive migration"
			if t.Phase == "verifying" {
				if _, exists := snap.Torrents[t.Key]; !exists {
					outcome = "legacy deletion observed before archive migration"
					if e := receipt(ctx, tx, "content", t.Key, "removed", now); e != nil {
						return e
					}
					if _, e := tx.ExecContext(ctx, "INSERT OR IGNORE INTO receipts VALUES('media',?,'removed',?)", t.Key, now); e != nil {
						return e
					}
					if _, e := tx.ExecContext(ctx, "DELETE FROM tasks WHERE id=?", "media:"+t.Key); e != nil {
						return e
					}
				}
			}
			if _, e := tx.ExecContext(ctx, "INSERT INTO events(at,kind,details) VALUES(?,'state_upgrade',?)", now, string(encode(map[string]string{"hash": t.Key, "outcome": outcome}))); e != nil {
				return e
			}
			if _, e := tx.ExecContext(ctx, "DELETE FROM owners WHERE resource=?", t.Resource); e != nil {
				return e
			}
			if _, e := tx.ExecContext(ctx, "DELETE FROM tasks WHERE id=?", t.ID); e != nil {
				return e
			}
		}
		if _, e := tx.ExecContext(ctx, schema); e != nil {
			return e
		}
		if _, e := tx.ExecContext(ctx, "UPDATE meta SET value='3' WHERE key='schema'"); e != nil {
			return e
		}
		_, e := tx.ExecContext(ctx, "INSERT INTO meta VALUES('archive_upgrade',?)", fmt.Sprint(now))
		return e
	})
}
