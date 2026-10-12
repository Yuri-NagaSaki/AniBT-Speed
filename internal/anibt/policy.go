package anibt

import (
	"cmp"
	"path"
	"slices"
	"strings"
	"time"
)

// Component trie protects every owner in an overlapping subtree, regardless of
// punctuation, input order, other categories, or an intervening sibling name.
type pathNode struct {
	children map[string]*pathNode
	owners   []string
}

func SharedContent(ts map[string]Torrent) map[string]bool {
	root := &pathNode{}
	unsafe := map[string]bool{}
	for h, t := range ts {
		if t.ContentPath == "" {
			continue
		}
		n := root
		for _, p := range strings.Split(path.Clean(t.ContentPath), "/") {
			if n.children == nil {
				n.children = map[string]*pathNode{}
			}
			if n.children[p] == nil {
				n.children[p] = &pathNode{}
			}
			n = n.children[p]
		}
		n.owners = append(n.owners, h)
	}
	var visit func(*pathNode, []string) bool
	visit = func(n *pathNode, parents []string) bool {
		owners := append(slices.Clone(parents), n.owners...)
		desc := false
		for _, ch := range n.children {
			if visit(ch, owners) {
				desc = true
			}
		}
		if len(n.owners) > 0 && (len(parents) > 0 || len(n.owners) > 1 || desc) {
			for _, h := range owners {
				unsafe[h] = true
			}
		}
		return len(n.owners) > 0 || desc
	}
	visit(root, nil)
	return unsafe
}
func PlanQueue(ts map[string]Torrent, c Config, ex map[string]Exposure, now int64, rotate bool) []Command {
	if !c.Pool {
		return nil
	}
	var active, stopped, idle []Torrent
	reserved := 0
	hot := func(t Torrent) bool {
		at := t.CompletedAt
		if at <= 0 {
			at = t.Added
		}
		return at <= 0 || time.Duration(now-at)*time.Second < c.Hot
	}
	for _, t := range ts {
		if !t.Managed(c) || t.Progress < 1 {
			continue
		}
		if t.Active() {
			active = append(active, t)
			if !hot(t) && !t.Demand() {
				idle = append(idle, t)
			}
		} else if t.Stopped() {
			stopped = append(stopped, t)
		} else if slices.Contains([]string{"forcedUP", "queuedUP", "checkingUP", "moving", "allocating"}, t.State) {
			reserved++
		}
	}
	slices.SortFunc(stopped, func(a, b Torrent) int {
		if x := cmp.Compare(ex[a.Hash].Last, ex[b.Hash].Last); x != 0 {
			return x
		}
		if x := cmp.Compare(a.Added, b.Added); x != 0 {
			return x
		}
		return cmp.Compare(a.Hash, b.Hash)
	})
	slices.SortFunc(idle, func(a, b Torrent) int {
		if x := cmp.Compare(ex[a.Hash].Started, ex[b.Hash].Started); x != 0 {
			return x
		}
		return cmp.Compare(a.Hash, b.Hash)
	})
	var resume, remaining, pause []string
	for _, t := range stopped {
		if len(resume) < c.PoolBatch && (hot(t) || t.Demand()) {
			resume = append(resume, t.Hash)
		} else {
			remaining = append(remaining, t.Hash)
		}
	}
	excess := max(0, len(active)+reserved+len(resume)-c.PoolTarget)
	n := min(excess, c.PoolBatch, len(idle))
	for _, t := range idle[:n] {
		pause = append(pause, t.Hash)
	}
	idle = idle[n:]
	fill := min(max(0, c.PoolTarget-len(active)-reserved-len(resume)+len(pause)), c.PoolBatch-len(resume), len(remaining))
	resume = append(resume, remaining[:fill]...)
	remaining = remaining[fill:]
	if rotate {
		slots := min(c.RotationBatch, len(remaining), c.PoolBatch-len(pause), c.PoolBatch-len(resume))
		for _, t := range idle {
			if slots <= 0 {
				break
			}
			if ex[t.Hash].Started > 0 && time.Duration(now-ex[t.Hash].Started)*time.Second >= c.Exposure {
				pause = append(pause, t.Hash)
				resume = append(resume, remaining[0])
				remaining = remaining[1:]
				slots--
			}
		}
	}
	var out []Command
	if len(pause) > 0 {
		out = append(out, Command{Kind: "stop", Hashes: pause, Reason: "idle rotation"})
	}
	if len(resume) > 0 {
		out = append(out, Command{Kind: "start", Hashes: resume, Reason: "demand or fair rotation"})
	}
	return out
}
func PlanCleanup(ts map[string]Torrent, c Config, pressure bool, now int64) []Torrent {
	if !c.Cleanup || c.CleanupBatch == 0 {
		return nil
	}
	shared := SharedContent(ts)
	var eligible []Torrent
	// An unknown content root could own a candidate's files. Fail closed until
	// qB metadata has converged; do not guess an ownership proof.
	for _, t := range ts {
		if t.ContentPath == "" || !path.IsAbs(t.ContentPath) || path.Clean(t.ContentPath) != t.ContentPath {
			return nil
		}
	}
	for h, t := range ts {
		if shared[h] || !t.Managed(c) || !within(c.QBTRoot, t.ContentPath) || !within(t.SavePath, t.ContentPath) || t.ContentPath == c.QBTRoot || !t.Complete() || t.State == "forcedUP" || t.Demand() || t.Age(now) < c.Protect {
			continue
		}
		if pressure || (c.RetainDays > 0 && t.Age(now) >= time.Duration(c.RetainDays)*24*time.Hour) {
			eligible = append(eligible, t)
		}
	}
	slices.SortFunc(eligible, func(a, b Torrent) int {
		if pressure {
			if x := cmp.Compare(b.Ratio, a.Ratio); x != 0 {
				return x
			}
		}
		if x := cmp.Compare(a.CompletedAt, b.CompletedAt); x != 0 {
			return x
		}
		return cmp.Compare(a.Hash, b.Hash)
	})
	n := c.CleanupBatch
	if pressure {
		n = 1
	}
	return eligible[:min(n, len(eligible))]
}
