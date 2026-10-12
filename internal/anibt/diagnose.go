package anibt

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net/url"
	"time"
)

type FileCheck struct {
	Name     string `json:"name"`
	Expected int64  `json:"expected_bytes"`
	Actual   int64  `json:"actual_bytes,omitempty"`
	Error    string `json:"error,omitempty"`
}
type Diagnosis struct {
	Hash           string      `json:"hash"`
	State          string      `json:"state"`
	Shared         bool        `json:"shared_content"`
	Files          []FileCheck `json:"files"`
	RecheckAllowed bool        `json:"recheck_allowed"`
}

func DiagnoseCLI(ctx context.Context, c Config, command string, args []string) error {
	f := flag.NewFlagSet(command, flag.ContinueOnError)
	probe := f.Bool("probe", false, "read one sample through MediaInfo without upload")
	hash := f.String("hash", "", "one exact torrent hash")
	apply := f.Bool("recheck", false, "request qB recheck after all local file sizes and ownership pass")
	if e := f.Parse(args); e != nil {
		return e
	}
	if !hashPattern.MatchString(*hash) {
		return fmt.Errorf("an exact --hash is required")
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	q := NewQBT(c, true)
	snap, e := q.Snapshot(ctx)
	if e != nil {
		return e
	}
	t, ok := snap.Torrents[*hash]
	if !ok {
		return fmt.Errorf("torrent not found")
	}
	if !t.Managed(c) {
		return fmt.Errorf("torrent is outside the managed scope")
	}
	files, e := q.Files(ctx, *hash)
	if e != nil {
		return e
	}
	d := Diagnosis{Hash: *hash, State: t.State, Shared: SharedContent(snap.Torrents)[*hash], Files: []FileCheck{}, RecheckAllowed: true}
	if d.Shared {
		d.RecheckAllowed = false
	}
	for _, file := range files {
		if e = ctx.Err(); e != nil {
			return e
		}
		check := FileCheck{Name: file.Name, Expected: file.Size}
		f, e := OpenMedia(c, t.SavePath, file.Name)
		if e != nil {
			check.Error = e.Error()
		} else {
			st, e := f.Stat()
			f.Close()
			if e != nil {
				check.Error = "stat failed"
			} else {
				check.Actual = st.Size()
				if st.Size() != file.Size {
					check.Error = "size mismatch"
				}
			}
		}
		if check.Error != "" {
			d.RecheckAllowed = false
		}
		d.Files = append(d.Files, check)
	}
	if *probe && d.RecheckAllowed {
		samples := SelectSamples(files, 1)
		if len(samples) == 0 {
			return fmt.Errorf("no media sample")
		}
		parsed, e := Extract(ctx, c, t.SavePath, samples[0])
		if e != nil {
			return e
		}
		fmt.Printf("MediaInfo probe passed: video=%d audio=%d subtitle=%d\n", len(parsed.Video), len(parsed.Audio), len(parsed.Subtitle))
	}
	b, _ := json.MarshalIndent(d, "", "  ")
	fmt.Println(string(b))
	if command == "recover" {
		if !*apply {
			return fmt.Errorf("recovery requires explicit --recheck")
		}
		if !d.RecheckAllowed {
			return fmt.Errorf("recheck refused: missing, mismatched, or shared files need manual recovery")
		}
		lock, e := Lock(c.StateDir)
		if e != nil {
			return fmt.Errorf("stop the worker before a recovery command")
		}
		defer lock.Close()
		q.ReadOnly = false
		_, e = q.form(ctx, "torrents/recheck", url.Values{"hashes": {*hash}})
		return e
	}
	return nil
}
