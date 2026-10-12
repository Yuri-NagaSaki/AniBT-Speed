package anibt

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type MediaWork struct {
	Hash     string            `json:"hash"`
	Name     string            `json:"name"`
	SavePath string            `json:"save_path"`
	Files    []File            `json:"files,omitempty"`
	Samples  map[string]Tracks `json:"samples,omitempty"`
	Payload  json.RawMessage   `json:"payload,omitempty"`
}
type cappedBuffer struct {
	bytes.Buffer
	limit int
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.Len() {
		return 0, fmt.Errorf("process output exceeds limit")
	}
	return b.Buffer.Write(p)
}
func OpenMedia(c Config, save, name string) (*os.File, error) {
	if !within(c.QBTRoot, save) || path.IsAbs(name) || strings.ContainsRune(name, 0) || strings.Contains(name, "\\") {
		return nil, fmt.Errorf("unsafe media path")
	}
	for _, p := range strings.Split(name, "/") {
		if p == ".." {
			return nil, fmt.Errorf("unsafe media path")
		}
	}
	rel := strings.TrimPrefix(strings.TrimPrefix(save, c.QBTRoot), "/")
	root, e := os.OpenRoot(c.MediaRoot)
	if e != nil {
		return nil, fmt.Errorf("media root unavailable")
	}
	defer root.Close()
	f, e := root.Open(filepath.Join(rel, filepath.FromSlash(name)))
	if e != nil {
		return nil, fmt.Errorf("media file missing or outside root")
	}
	st, e := f.Stat()
	if e != nil || !st.Mode().IsRegular() {
		f.Close()
		return nil, fmt.Errorf("media path is not a regular file")
	}
	return f, nil
}
func Extract(ctx context.Context, c Config, save string, f File) (Tracks, error) {
	file, e := OpenMedia(c, save, f.Name)
	if e != nil {
		return Tracks{}, e
	}
	defer file.Close()
	st, e := file.Stat()
	if e != nil || st.Size() != f.Size {
		return Tracks{}, fmt.Errorf("media file size differs from qB manifest")
	}
	ctx, cancel := context.WithTimeout(ctx, c.MediaTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "nice", "-n", "19", "ionice", "-c", "3", "prlimit", "--as="+strconv.Itoa(c.MediaMemoryMiB*(1<<20)), "--", "mediainfo", "--Output=JSON", "/proc/self/fd/3")
	cmd.ExtraFiles = []*os.File{file}
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGKILL}
	cmd.Cancel = func() error {
		if cmd.Process != nil {
			return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		}
		return nil
	}
	cmd.WaitDelay = time.Second
	output := &cappedBuffer{limit: 1 << 20}
	cmd.Stdout = output
	if e = cmd.Run(); e != nil {
		if ctx.Err() != nil {
			return Tracks{}, ctx.Err()
		}
		return Tracks{}, fmt.Errorf("MediaInfo extraction failed")
	}
	return ParseTracks(output.Bytes())
}
func IOPressure() float64 {
	b, e := os.ReadFile("/proc/pressure/io")
	if e != nil {
		return 0
	}
	for _, line := range strings.Split(string(b), "\n") {
		if !strings.HasPrefix(line, "full ") {
			continue
		}
		for _, field := range strings.Fields(line) {
			if v, ok := strings.CutPrefix(field, "avg10="); ok {
				n, _ := strconv.ParseFloat(v, 64)
				return n
			}
		}
	}
	return 0
}

type Media struct {
	c       Config
	s       *Store
	http    *http.Client
	extract func(context.Context, Config, string, File) (Tracks, error)
}

func NewMedia(c Config, s *Store) *Media {
	return &Media{c: c, s: s, http: newHTTP(1, false), extract: Extract}
}
func (m *Media) Step(ctx context.Context) error {
	t, e := m.s.Claim(ctx, "media", []string{"upload"}, 2*time.Minute)
	if e != nil {
		return e
	}
	if t == nil {
		if m.c.MediaIOPressure > 0 && IOPressure() >= m.c.MediaIOPressure {
			return nil
		}
		t, e = m.s.Claim(ctx, "media", []string{"extract"}, m.c.MediaTimeout+time.Minute)
		if e != nil {
			return e
		}
	}
	if t == nil {
		return nil
	}
	e = m.one(ctx, *t)
	if e != nil {
		var httpErr *HTTPError
		itemRejection := errors.As(e, &httpErr) && (httpErr.Status == 404 || httpErr.Status == 422 || httpErr.Status == 400)
		if t.Phase == "upload" && !itemRejection {
			settle(func(cx context.Context) error { return m.s.DeferDependency(cx, *t, e, retryDelay(e)) })
			return e
		}
		settle(func(cx context.Context) error { return m.s.Retry(cx, *t, e, retryDelay(e)) })
	}
	return nil
}
func (m *Media) one(ctx context.Context, t Task) error {
	var w MediaWork
	if e := json.Unmarshal(t.Data, &w); e != nil {
		return fmt.Errorf("invalid media task")
	}
	if t.Phase == "upload" {
		ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
		b, _, _, e := request(ctx, m.http, "AniBT media", "PUT", strings.TrimRight(m.c.APIRoot, "/")+"/api/releases/mediainfo", bytes.NewReader(w.Payload), map[string]string{"Authorization": "Bearer " + m.c.APIToken, "Content-Type": "application/json"}, 1<<20)
		if e != nil {
			return e
		}
		var ack struct {
			OK bool `json:"ok"`
		}
		if json.Unmarshal(b, &ack) != nil || !ack.OK {
			return fmt.Errorf("AniBT did not acknowledge MediaInfo")
		}
		return m.s.Finish(ctx, t, "media", w.Hash, "delivered", "")
	}
	samples := SelectSamples(w.Files, m.c.MediaSamples)
	if len(samples) == 0 {
		return m.s.Finish(ctx, t, "media", w.Hash, "no media tracks", "")
	}
	if w.Samples == nil {
		w.Samples = map[string]Tracks{}
	}
	selected := map[string]bool{}
	for _, f := range samples {
		selected[f.Name] = true
	}
	for name := range w.Samples {
		if !selected[name] {
			delete(w.Samples, name)
		}
	}
	for _, f := range samples {
		if _, done := w.Samples[f.Name]; done {
			continue
		}
		parsed, e := m.extract(ctx, m.c, w.SavePath, f)
		if e != nil {
			return e
		}
		w.Samples[f.Name] = parsed
		break
	}
	phase := "extract"
	if len(w.Samples) == len(samples) {
		payload, e := BuildPayload(w)
		if e != nil {
			return e
		}
		w.Payload = payload
		w.Samples = nil
		phase = "upload"
	}
	return m.s.Transition(ctx, t, phase, t.Resource, w, time.Second)
}
