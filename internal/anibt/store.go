package anibt

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
INSERT OR IGNORE INTO meta VALUES('schema','2');
CREATE TABLE IF NOT EXISTS feeds(slug TEXT PRIMARY KEY,name TEXT NOT NULL,enabled INTEGER NOT NULL,initialized INTEGER NOT NULL DEFAULT 0,etag TEXT NOT NULL DEFAULT '',modified TEXT NOT NULL DEFAULT '',polled INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS sources(key TEXT PRIMARY KEY,slug TEXT NOT NULL,fingerprint TEXT NOT NULL,data BLOB NOT NULL,updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rejected(slug TEXT NOT NULL,key TEXT NOT NULL,reason TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(slug,key));
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,lane TEXT NOT NULL,key TEXT NOT NULL,phase TEXT NOT NULL,resource TEXT NOT NULL,data BLOB NOT NULL,revision INTEGER NOT NULL DEFAULT 1,attempts INTEGER NOT NULL DEFAULT 0,due INTEGER NOT NULL DEFAULT 0,updated INTEGER NOT NULL,error TEXT NOT NULL DEFAULT '',token TEXT NOT NULL DEFAULT '',lease INTEGER NOT NULL DEFAULT 0,UNIQUE(lane,key));
CREATE INDEX IF NOT EXISTS tasks_due ON tasks(lane,phase,due,updated);
CREATE TABLE IF NOT EXISTS owners(resource TEXT PRIMARY KEY,token TEXT NOT NULL,until INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS receipts(kind TEXT NOT NULL,key TEXT NOT NULL,outcome TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(kind,key));
CREATE TABLE IF NOT EXISTS exposures(hash TEXT PRIMARY KEY,started INTEGER NOT NULL,last INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS traffic(start INTEGER NOT NULL,end INTEGER NOT NULL,uploaded INTEGER NOT NULL,downloaded INTEGER NOT NULL,known INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS traffic_end ON traffic(end);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,kind TEXT NOT NULL,details TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_at ON events(at);
CREATE TABLE IF NOT EXISTS counters(key TEXT PRIMARY KEY,n INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS task_insert AFTER INSERT ON tasks BEGIN INSERT INTO counters VALUES('task:'||NEW.lane||':'||NEW.phase,1) ON CONFLICT(key) DO UPDATE SET n=n+1; END;
CREATE TRIGGER IF NOT EXISTS task_delete AFTER DELETE ON tasks BEGIN UPDATE counters SET n=n-1 WHERE key='task:'||OLD.lane||':'||OLD.phase; END;
CREATE TRIGGER IF NOT EXISTS task_update AFTER UPDATE OF phase ON tasks WHEN OLD.phase<>NEW.phase BEGIN UPDATE counters SET n=n-1 WHERE key='task:'||OLD.lane||':'||OLD.phase; INSERT INTO counters VALUES('task:'||NEW.lane||':'||NEW.phase,1) ON CONFLICT(key) DO UPDATE SET n=n+1; END;
CREATE TRIGGER IF NOT EXISTS task_error_update AFTER UPDATE OF error ON tasks WHEN (OLD.error='')<>(NEW.error='') BEGIN INSERT INTO counters VALUES('error:'||NEW.lane,CASE WHEN NEW.error='' THEN -1 ELSE 1 END) ON CONFLICT(key) DO UPDATE SET n=n+excluded.n; END;
CREATE TRIGGER IF NOT EXISTS task_error_delete AFTER DELETE ON tasks WHEN OLD.error<>'' BEGIN UPDATE counters SET n=n-1 WHERE key='error:'||OLD.lane; END;
CREATE TRIGGER IF NOT EXISTS receipt_insert AFTER INSERT ON receipts BEGIN INSERT INTO counters VALUES('receipt:'||NEW.kind,1) ON CONFLICT(key) DO UPDATE SET n=n+1; END;
CREATE TRIGGER IF NOT EXISTS receipt_delete AFTER DELETE ON receipts BEGIN UPDATE counters SET n=n-1 WHERE key='receipt:'||OLD.kind; END;
`

var ErrStale = errors.New("task claim expired or superseded")

type Store struct {
	db          *sql.DB
	Notify      bool
	MaxAttempts int
	path        string
}
type Task struct {
	ID, Lane, Key, Phase, Resource string
	Data                           []byte
	Revision, Attempts             int
	Due, Updated                   int64
	Error, Token                   string
	Lease                          int64
}

const taskColumns = "id,lane,key,phase,resource,data,revision,attempts,due,updated,error,token,lease"

type scanner interface{ Scan(...any) error }

func scanTask(row scanner) (t Task, e error) {
	e = row.Scan(&t.ID, &t.Lane, &t.Key, &t.Phase, &t.Resource, &t.Data, &t.Revision, &t.Attempts, &t.Due, &t.Updated, &t.Error, &t.Token, &t.Lease)
	return
}
func OpenStore(file string, notify bool, maxAttempts int) (*Store, error) {
	if e := os.MkdirAll(filepath.Dir(file), 0700); e != nil {
		return nil, e
	}
	db, e := sql.Open("sqlite", file+"?_pragma=busy_timeout(2000)&_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)")
	if e != nil {
		return nil, e
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, Notify: notify, MaxAttempts: maxAttempts, path: file}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var exists int
	e = db.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='meta'").Scan(&exists)
	if e == nil && exists > 0 {
		var ver string
		e = db.QueryRowContext(ctx, "SELECT value FROM meta WHERE key='schema'").Scan(&ver)
		if e == nil && ver != "2" {
			e = fmt.Errorf("unsupported state schema; use explicit import-v1 into a new state directory")
		}
	}
	if e == nil {
		_, e = db.ExecContext(ctx, schema)
	}
	if e != nil {
		db.Close()
		return nil, e
	}
	if e = os.Chmod(file, 0600); e != nil {
		db.Close()
		return nil, e
	}
	return s, nil
}
func (s *Store) Close() error { return s.db.Close() }
func (s *Store) tx(ctx context.Context, fn func(*sql.Tx) error) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if e = fn(tx); e != nil {
		return e
	}
	if e = ctx.Err(); e != nil {
		return e
	}
	return tx.Commit()
}
func encode(v any) []byte {
	b, e := json.Marshal(v)
	if e != nil {
		panic(e)
	}
	return b
}
func token() string {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b[:])
}
func putTask(ctx context.Context, tx *sql.Tx, lane, key, phase, resource string, data any, now int64) error {
	_, e := tx.ExecContext(ctx, `INSERT OR IGNORE INTO tasks(id,lane,key,phase,resource,data,updated) VALUES(?,?,?,?,?,?,?)`, lane+":"+key, lane, key, phase, resource, encode(data), now)
	return e
}
func receipt(ctx context.Context, tx *sql.Tx, kind, key, outcome string, now int64) error {
	_, e := tx.ExecContext(ctx, `INSERT INTO receipts VALUES(?,?,?,?) ON CONFLICT(kind,key) DO UPDATE SET outcome=excluded.outcome,at=excluded.at`, kind, key, outcome, now)
	return e
}
func (s *Store) event(ctx context.Context, tx *sql.Tx, key, kind, message string, now int64) error {
	if _, e := tx.ExecContext(ctx, "INSERT INTO events(at,kind,details) VALUES(?,?,?)", now, kind, message); e != nil {
		return e
	}
	if s.Notify && message != "" {
		return putTask(ctx, tx, "notify", key, "send", "notify:"+key, Notification{Text: message}, now)
	}
	return nil
}
func (s *Store) Enqueue(ctx context.Context, lane, key, phase, resource string, data any) error {
	return s.tx(ctx, func(tx *sql.Tx) error { return putTask(ctx, tx, lane, key, phase, resource, data, time.Now().Unix()) })
}
func (s *Store) Claim(ctx context.Context, lane string, phases []string, ttl time.Duration) (task *Task, err error) {
	now := time.Now().Unix()
	err = s.tx(ctx, func(tx *sql.Tx) error {
		args := []any{lane, now, now}
		marks := make([]string, len(phases))
		for i, p := range phases {
			marks[i] = "?"
			args = append(args, p)
		}
		args = append(args, now)
		t, e := scanTask(tx.QueryRowContext(ctx, "SELECT "+taskColumns+" FROM tasks WHERE lane=? AND due<=? AND lease<=? AND phase IN ("+strings.Join(marks, ",")+") AND NOT EXISTS(SELECT 1 FROM owners WHERE owners.resource=tasks.resource AND owners.until>?) AND (lane='cleanup' OR NOT EXISTS(SELECT 1 FROM tasks AS deleting WHERE deleting.lane='cleanup' AND deleting.phase<>'blocked' AND deleting.resource=tasks.resource)) ORDER BY due,updated,id LIMIT 1", args...))
		if errors.Is(e, sql.ErrNoRows) {
			return nil
		}
		if e != nil {
			return e
		}
		t.Token = token()
		t.Lease = now + int64(ttl/time.Second)
		if _, e = tx.ExecContext(ctx, "INSERT INTO owners VALUES(?,?,?) ON CONFLICT(resource) DO UPDATE SET token=excluded.token,until=excluded.until", t.Resource, t.Token, t.Lease); e != nil {
			return e
		}
		_, e = tx.ExecContext(ctx, "UPDATE tasks SET token=?,lease=? WHERE id=?", t.Token, t.Lease, t.ID)
		task = &t
		return e
	})
	return
}
func claimValid(ctx context.Context, tx *sql.Tx, t Task) error {
	var n int
	e := tx.QueryRowContext(ctx, `SELECT count(*) FROM tasks JOIN owners ON owners.resource=tasks.resource AND owners.token=tasks.token WHERE id=? AND tasks.token=? AND revision=? AND tasks.lease>? AND owners.until>?`, t.ID, t.Token, t.Revision, time.Now().Unix(), time.Now().Unix()).Scan(&n)
	if e != nil {
		return e
	}
	if n != 1 {
		return ErrStale
	}
	return nil
}
func releaseOwner(ctx context.Context, tx *sql.Tx, t Task) error {
	_, e := tx.ExecContext(ctx, "DELETE FROM owners WHERE resource=? AND token=?", t.Resource, t.Token)
	return e
}
func (s *Store) Transition(ctx context.Context, t Task, phase, resource string, data any, delay time.Duration) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if e := claimValid(ctx, tx, t); e != nil {
			return e
		}
		_, e := tx.ExecContext(ctx, `UPDATE tasks SET phase=?,resource=?,data=?,revision=revision+1,attempts=0,due=?,updated=?,error='',token='',lease=0 WHERE id=?`, phase, resource, encode(data), time.Now().Add(delay).Unix(), time.Now().Unix(), t.ID)
		if e != nil {
			return e
		}
		return releaseOwner(ctx, tx, t)
	})
}
func (s *Store) Retry(ctx context.Context, t Task, cause error, minimum time.Duration) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if e := claimValid(ctx, tx, t); e != nil {
			return e
		}
		attempts := t.Attempts + 1
		delay := min(24*time.Hour, max(minimum, 30*time.Second*time.Duration(1<<min(attempts, 10))))
		phase := t.Phase
		if attempts >= s.MaxAttempts && t.Lane != "notify" {
			phase = "blocked"
		}
		message := cause.Error()
		if len(message) > 300 {
			message = message[:300]
		}
		_, e := tx.ExecContext(ctx, `UPDATE tasks SET phase=?,attempts=?,due=?,updated=?,error=?,token='',lease=0 WHERE id=?`, phase, attempts, time.Now().Add(delay).Unix(), time.Now().Unix(), message, t.ID)
		if e != nil {
			return e
		}
		if phase == "blocked" {
			if e = s.event(ctx, tx, "blocked:"+t.ID+":"+fmt.Sprint(t.Revision), "blocked", "AniBT 任务已暂停重试："+t.ID+"（"+message+"）", time.Now().Unix()); e != nil {
				return e
			}
		}
		return releaseOwner(ctx, tx, t)
	})
}
func (s *Store) Finish(ctx context.Context, t Task, kind, key, outcome, message string) error {
	return s.tx(ctx, func(tx *sql.Tx) error {
		if e := claimValid(ctx, tx, t); e != nil {
			return e
		}
		if kind != "" {
			if e := receipt(ctx, tx, kind, key, outcome, time.Now().Unix()); e != nil {
				return e
			}
		}
		if message != "" {
			if e := s.event(ctx, tx, kind+":"+key, kind, message, time.Now().Unix()); e != nil {
				return e
			}
		}
		if _, e := tx.ExecContext(ctx, "DELETE FROM tasks WHERE id=?", t.ID); e != nil {
			return e
		}
		return releaseOwner(ctx, tx, t)
	})
}
func (s *Store) Stats(ctx context.Context) (map[string]int64, error) {
	rows, e := s.db.QueryContext(ctx, "SELECT key,n FROM counters WHERE n>0")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var k string
		var n int64
		if e = rows.Scan(&k, &n); e != nil {
			return nil, e
		}
		out[k] = n
	}
	return out, rows.Err()
}
func (s *Store) Queue(ctx context.Context, lane string) ([]Task, error) {
	rows, e := s.db.QueryContext(ctx, "SELECT "+taskColumns+" FROM tasks WHERE (?='' OR lane=?) ORDER BY updated LIMIT 200", lane, lane)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Task{}
	for rows.Next() {
		t, e := scanTask(rows)
		if e != nil {
			return nil, e
		}
		t.Data = nil
		t.Token = ""
		out = append(out, t)
	}
	return out, rows.Err()
}
func (s *Store) Backup(ctx context.Context, dest string) error {
	if _, e := os.Stat(dest); !os.IsNotExist(e) {
		return fmt.Errorf("backup destination already exists")
	}
	_, e := s.db.ExecContext(ctx, "VACUUM INTO ?", dest)
	return e
}
func (s *Store) Recover(ctx context.Context) error {
	// Called only while holding the exclusive process lock, after all old work exited.
	return s.tx(ctx, func(tx *sql.Tx) error {
		if _, e := tx.ExecContext(ctx, "DELETE FROM owners"); e != nil {
			return e
		}
		_, e := tx.ExecContext(ctx, "UPDATE tasks SET token='',lease=0,due=max(due,?) WHERE token<>''", time.Now().Add(5*time.Second).Unix())
		return e
	})
}
