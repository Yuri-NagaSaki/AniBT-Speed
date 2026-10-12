package anibt

import (
	"path"
	"regexp"
	"strings"
	"time"
)

var hashPattern = regexp.MustCompile(`^(?:[a-f0-9]{40}|[a-f0-9]{64})$`)

type Torrent struct {
	Hash         string  `json:"hash"`
	Name         string  `json:"name"`
	State        string  `json:"state"`
	Category     string  `json:"category"`
	SavePath     string  `json:"save_path"`
	ContentPath  string  `json:"content_path"`
	Tags         string  `json:"tags"`
	Progress     float64 `json:"progress"`
	Added        int64   `json:"added_on"`
	CompletedAt  int64   `json:"completion_on"`
	LastActivity int64   `json:"last_activity"`
	Leechers     int     `json:"num_leechs"`
	UpSpeed      int64   `json:"upspeed"`
	DownSpeed    int64   `json:"dlspeed"`
	Ratio        float64 `json:"ratio"`
	Size         int64   `json:"size"`
}

func within(root, p string) bool {
	return path.IsAbs(p) && path.Clean(p) == strings.TrimSuffix(p, "/") && (p == root || strings.HasPrefix(p, strings.TrimSuffix(root, "/")+"/"))
}
func (t Torrent) Managed(c Config) bool {
	if t.Category != c.Category || !within(c.QBTRoot, t.SavePath) {
		return false
	}
	protected := splitSet(c.ExcludedTags)
	for tag := range splitSet(t.Tags) {
		if protected[tag] {
			return false
		}
	}
	return true
}
func (t Torrent) Active() bool  { return t.State == "uploading" || t.State == "stalledUP" }
func (t Torrent) Stopped() bool { return t.State == "stoppedUP" || t.State == "pausedUP" }
func (t Torrent) Complete() bool {
	return t.Progress >= 1 && (t.Active() || t.Stopped() || t.State == "forcedUP")
}
func (t Torrent) Demand() bool { return t.Leechers > 0 || t.UpSpeed > 0 }
func (t Torrent) Age(now int64) time.Duration {
	if !t.Complete() || t.CompletedAt <= 0 {
		return -1
	}
	return time.Duration(now-t.CompletedAt) * time.Second
}

type Snapshot struct {
	Torrents   map[string]Torrent `json:"torrents"`
	Server     map[string]float64 `json:"server"`
	Categories map[string]bool    `json:"categories"`
	At         int64              `json:"at"`
}
type Exposure struct{ Started, Last int64 }
type Command struct {
	Kind   string   `json:"kind"`
	Hashes []string `json:"hashes,omitempty"`
	Limit  int64    `json:"limit,omitempty"`
	Reason string   `json:"reason,omitempty"`
}
type File struct {
	Name     string  `json:"name"`
	Size     int64   `json:"size"`
	Progress float64 `json:"progress"`
}
