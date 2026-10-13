package anibt

import (
	"context"
	"encoding/json"
	"fmt"
	"path"
	"time"
)

// The manifest is persisted before qB removal so verification and media work can
// finish after qB no longer knows the torrent. Local content is never mutated.
type ArchiveWork struct {
	Hash        string `json:"hash"`
	Name        string `json:"name"`
	SavePath    string `json:"save_path"`
	Files       []File `json:"files"`
	Submissions int    `json:"submissions"`
	Requested   int64  `json:"requested"`
}

func verifyArchiveFiles(ctx context.Context, c Config, w ArchiveWork) error {
	if !hashPattern.MatchString(w.Hash) || !within(c.QBTRoot, w.SavePath) || len(w.Files) == 0 {
		return fmt.Errorf("archive manifest missing or invalid")
	}
	for _, file := range w.Files {
		if e := ctx.Err(); e != nil {
			return e
		}
		if file.Progress < 1 || file.Size < 0 {
			return fmt.Errorf("archive requires complete files")
		}
		f, e := OpenMedia(c, w.SavePath, file.Name)
		if e != nil {
			return fmt.Errorf("archive file missing or unsafe: %s", file.Name)
		}
		st, e := f.Stat()
		f.Close()
		if e != nil || st.Size() != file.Size {
			return fmt.Errorf("archive file size mismatch: %s", file.Name)
		}
	}
	return nil
}
func (c *Controller) archive(ctx context.Context) (bool, error) {
	t, e := c.s.Claim(ctx, "archive", []string{"ready"}, time.Minute)
	if e != nil || t == nil {
		return false, e
	}
	fail := func(err error, dependency bool) (bool, error) {
		settle(func(cx context.Context) error { return c.s.Retry(cx, *t, err, time.Minute) })
		if dependency {
			return true, err
		}
		return true, nil
	}
	fresh, e := c.q.Snapshot(ctx)
	if e != nil {
		return fail(e, true)
	}
	target, present := fresh.Torrents[t.Key]
	if !present || len(PlanArchive(map[string]Torrent{t.Key: target}, c.c, fresh.At)) == 0 {
		return true, c.s.Finish(ctx, *t, "", "", "", "")
	}
	var w ArchiveWork
	if json.Unmarshal(t.Data, &w) != nil {
		return fail(fmt.Errorf("invalid archive work"), false)
	}
	files, e := c.q.Files(ctx, t.Key)
	if e != nil {
		return fail(e, true)
	}
	for _, file := range files {
		if !within(target.ContentPath, path.Join(target.SavePath, file.Name)) {
			return fail(fmt.Errorf("archive manifest escapes content root"), false)
		}
	}
	w.Hash = target.Hash
	w.Name = target.Name
	w.SavePath = target.SavePath
	w.Files = files
	if e = verifyArchiveFiles(ctx, c.c, w); e != nil {
		return fail(e, false)
	}
	if !target.Stopped() {
		if e = c.q.Execute(ctx, Command{Kind: "stop", Hashes: []string{t.Key}}); e != nil {
			return fail(e, true)
		}
	}
	w.Requested = time.Now().Unix()
	w.Submissions++
	if e = c.s.Transition(ctx, *t, "verifying", t.Resource, w, 0); e != nil {
		return true, e
	}
	// This is the only removal command in the Worker. Its adapter hardcodes
	// deleteFiles=false; disk pressure cannot opt into destructive deletion.
	return true, c.q.Execute(ctx, Command{Kind: "archive", Hashes: []string{t.Key}})
}
