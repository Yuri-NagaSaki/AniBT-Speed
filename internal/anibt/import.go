package anibt

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"time"
)

// ImportV1 is a one-time offline transfer, not a compatibility runtime. Its
// transaction leaves source files untouched and preserves all success receipts.
func ImportV1(ctx context.Context, c Config, source string) error {
	source, e := filepath.Abs(source)
	if e != nil {
		return e
	}
	if source == filepath.Join(c.StateDir, "state.sqlite3") {
		return fmt.Errorf("source and destination must differ")
	}
	s, e := OpenStore(filepath.Join(c.StateDir, "state.sqlite3"), c.Notify, c.MaxAttempts)
	if e != nil {
		return e
	}
	defer s.Close()
	uri := (&url.URL{Scheme: "file", Path: source, RawQuery: "mode=ro"}).String()
	if _, e = s.db.ExecContext(ctx, "ATTACH DATABASE ? AS v1", uri); e != nil {
		return e
	}
	defer s.db.ExecContext(context.Background(), "DETACH DATABASE v1")
	return s.tx(ctx, func(tx *sql.Tx) error {
		var count int
		if e := tx.QueryRowContext(ctx, "SELECT (SELECT count(*) FROM receipts)+(SELECT count(*) FROM tasks)+(SELECT count(*) FROM feeds)").Scan(&count); e != nil {
			return e
		}
		if count > 0 {
			return fmt.Errorf("import destination must be empty")
		}
		var version string
		if e := tx.QueryRowContext(ctx, "SELECT value FROM v1.meta WHERE key='schema'").Scan(&version); e != nil || version != "1" {
			return fmt.Errorf("source is not a v1 state snapshot")
		}
		now := time.Now().Unix()
		queries := []string{
			`INSERT INTO feeds(slug,name,enabled,initialized,polled,error) SELECT slug,name,enabled,initialized,CAST(last_poll AS INTEGER),error FROM v1.feeds`,
			`INSERT INTO receipts SELECT 'release',key,outcome,` + fmt.Sprint(now) + ` FROM v1.seen_keys WHERE outcome NOT IN ('group identity mismatch','excluded group','release too old')`,
			`INSERT INTO receipts SELECT 'media',hash,'delivered',CAST(updated_at AS INTEGER) FROM v1.media WHERE status='done'`,
			`INSERT INTO exposures SELECT hash,CAST(started_at AS INTEGER),CAST(last_started_at AS INTEGER) FROM v1.exposures`,
			`INSERT INTO traffic SELECT CAST(ts-seconds AS INTEGER),CAST(ts AS INTEGER),CASE WHEN seconds<=90 THEN uploaded ELSE 0 END,CASE WHEN seconds<=90 THEN downloaded ELSE 0 END,seconds<=90 FROM v1.traffic WHERE seconds>0`,
		}
		for _, q := range queries {
			if _, e := tx.ExecContext(ctx, q); e != nil {
				return e
			}
		}
		rows, e := tx.QueryContext(ctx, `SELECT key,slug,title,url,metadata,coalesce(published,0),status,infohash,content,save_path,tags,created_at,updated_at,attempts,next_attempt,submitted_at,error FROM v1.releases`)
		if e != nil {
			return e
		}
		type oldDownload struct {
			d                                Download
			metadata, status, error          string
			created, updated, due, submitted float64
			attempts                         int
		}
		var downloads []oldDownload
		for rows.Next() {
			var v oldDownload
			var published float64
			if e = rows.Scan(&v.d.Key, &v.d.Slug, &v.d.Title, &v.d.URL, &v.metadata, &published, &v.status, &v.d.Hash, &v.d.Content, &v.d.SavePath, &v.d.Tags, &v.created, &v.updated, &v.attempts, &v.due, &v.submitted, &v.error); e != nil {
				rows.Close()
				return e
			}
			v.d.Published = int64(published)
			v.d.Submitted = int64(v.submitted)
			downloads = append(downloads, v)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		for _, v := range downloads {
			var metadata map[string]string
			if json.Unmarshal([]byte(v.metadata), &metadata) != nil {
				return fmt.Errorf("invalid v1 release metadata")
			}
			v.d.GroupName = metadata["group_name"]
			v.d.Anime = metadata["anime_title"]
			if v.d.Anime == "" {
				v.d.Anime = metadata["anime_title_english"]
			}
			v.d.BgmID = metadata["bgm_id"]
			original := v.d
			original.Content = nil
			original.Hash = ""
			original.SavePath = ""
			original.Tags = ""
			original.Submitted = 0
			if _, e = tx.ExecContext(ctx, "INSERT INTO sources VALUES(?,?,?, ?,?)", v.d.Key, v.d.Slug, "imported", encode(original), int64(v.updated)); e != nil {
				return e
			}
			if v.status == "ignored" {
				continue
			}
			phase := v.status
			if phase == "confirmed" {
				phase = "tracking"
				v.d.State = "imported"
				v.d.Observed = int64(v.updated)
				v.d.ProgressAt = now
				if e = receipt(ctx, tx, "content", v.d.Hash, "admitted", now); e != nil {
					return e
				}
				if e = receipt(ctx, tx, "release", v.d.Key, "admitted", now); e != nil {
					return e
				}
			}
			if phase != "pending" && phase != "ready" && phase != "submitted" && phase != "tracking" {
				return fmt.Errorf("unknown v1 release phase")
			}
			resource := "release:" + v.d.Key
			if v.d.Hash != "" {
				resource = "torrent:" + v.d.Hash
			}
			if e = putTask(ctx, tx, "download", v.d.Key, phase, resource, v.d, int64(v.updated)); e != nil {
				return e
			}
			if _, e = tx.ExecContext(ctx, "UPDATE tasks SET attempts=?,due=?,error=? WHERE id=?", v.attempts, int64(v.due), v.error, "download:"+v.d.Key); e != nil {
				return e
			}
		}
		rows, e = tx.QueryContext(ctx, `SELECT hash,name,save_path,status,coalesce(files,'null'),coalesce(payload,'null'),attempts,next_attempt,error,updated_at FROM v1.media WHERE status NOT IN ('done','skipped')`)
		if e != nil {
			return e
		}
		type oldMedia struct {
			w                            MediaWork
			phase, files, payload, error string
			attempts                     int
			due, updated                 float64
		}
		var media []oldMedia
		for rows.Next() {
			var v oldMedia
			if e = rows.Scan(&v.w.Hash, &v.w.Name, &v.w.SavePath, &v.phase, &v.files, &v.payload, &v.attempts, &v.due, &v.error, &v.updated); e != nil {
				rows.Close()
				return e
			}
			media = append(media, v)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		for _, v := range media {
			if e = json.Unmarshal([]byte(v.files), &v.w.Files); e != nil {
				return fmt.Errorf("invalid v1 media manifest")
			}
			if v.payload != "null" {
				if !json.Valid([]byte(v.payload)) {
					return fmt.Errorf("invalid v1 media payload")
				}
				v.w.Payload = json.RawMessage(v.payload)
			}
			if v.phase == "ready" {
				v.phase = "extract"
			}
			if !strings.Contains("|manifest|extract|upload|", "|"+v.phase+"|") {
				return fmt.Errorf("unknown v1 media phase")
			}
			if e = putTask(ctx, tx, "media", v.w.Hash, v.phase, "torrent:"+v.w.Hash, v.w, int64(v.updated)); e != nil {
				return e
			}
			if _, e = tx.ExecContext(ctx, "UPDATE tasks SET attempts=?,due=?,error=? WHERE id=?", v.attempts, int64(v.due), v.error, "media:"+v.w.Hash); e != nil {
				return e
			}
		}
		_, e = tx.ExecContext(ctx, "INSERT INTO meta VALUES('imported_v1',?)", fmt.Sprint(now))
		return e
	})
}
