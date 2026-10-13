package anibt

import (
	"fmt"
	"math/rand/v2"
	"path"
	"strings"
	"testing"
	"time"
)

func TestPathOwnershipPermutation(t *testing.T) {
	paths := []string{"/media/AniBT/Show", "/media/AniBT/Show-Extras", "/media/AniBT/Show/episode.mkv", "/media/AniBT/Show 2", "/media/AniBT/Show/child/x", "/media/AniBT/Show"}
	for i := 0; i < 100; i++ {
		rand.Shuffle(len(paths), func(i, j int) { paths[i], paths[j] = paths[j], paths[i] })
		ts := map[string]Torrent{}
		for j, p := range paths {
			h := fmt.Sprint(j)
			ts[h] = Torrent{Hash: h, ContentPath: p}
		}
		got := SharedContent(ts)
		for a, x := range ts {
			want := false
			for b, y := range ts {
				if a != b && (x.ContentPath == y.ContentPath || strings.HasPrefix(x.ContentPath, y.ContentPath+"/") || strings.HasPrefix(y.ContentPath, x.ContentPath+"/")) {
					want = true
				}
			}
			if got[a] != want {
				t.Fatalf("ownership mismatch %v %s", paths, a)
			}
		}
	}
}
func TestArchivePolicyPreservesActiveAndProtectedTorrents(t *testing.T) {
	c := testConfig(t)
	now := time.Now().Unix()
	ts := map[string]Torrent{}
	for i := 0; i < 10; i++ {
		h := fmt.Sprintf("%040x", i)
		ts[h] = Torrent{Hash: h, Name: "Show", Category: c.Category, SavePath: c.QBTRoot + "/" + h, ContentPath: c.QBTRoot + "/" + h + "/file.mkv", Progress: 1, State: "stoppedUP", CompletedAt: now - 100*86400}
	}
	excluded := map[int]func(*Torrent){0: func(t *Torrent) { t.Tags = "keep" }, 1: func(t *Torrent) { t.State = "forcedUP" }, 2: func(t *Torrent) { t.UpSpeed = 1 }, 3: func(t *Torrent) { t.Leechers = 1 }, 4: func(t *Torrent) { t.Progress = 0.9; t.State = "downloading" }, 5: func(t *Torrent) { t.CompletedAt = 0 }, 6: func(t *Torrent) { t.CompletedAt = now - 89*86400 }}
	for i, change := range excluded {
		h := fmt.Sprintf("%040x", i)
		x := ts[h]
		change(&x)
		ts[h] = x
	}
	plan := PlanArchive(ts, c, now)
	if len(plan) != 3 {
		t.Fatal(plan)
	}
	for _, x := range plan {
		for i := range excluded {
			if x.Hash == fmt.Sprintf("%040x", i) {
				t.Fatal("protected torrent archived", x)
			}
		}
	}
	// A foreign shared root cannot be harmed: archives never delete data.
	ts["foreign"] = Torrent{ContentPath: c.QBTRoot}
	if len(PlanArchive(ts, c, now)) != 3 {
		t.Fatal("unrelated shared path blocked safe archive")
	}
	c.ArchiveAfterDays = 0
	if len(PlanArchive(ts, c, now)) != 0 {
		t.Fatal("zero days must disable age archival")
	}
}
func TestQueuePreservesDemandAndExposure(t *testing.T) {
	c := testConfig(t)
	c.PoolTarget = 1
	now := time.Now().Unix()
	base := Torrent{Category: c.Category, SavePath: c.QBTRoot, State: "uploading", Progress: 1, CompletedAt: now - 86400, Added: 1}
	a, b := base, base
	a.Hash = "a"
	a.UpSpeed = 100
	b.Hash = "b"
	b.State = "stoppedUP"
	ts := map[string]Torrent{"a": a, "b": b}
	if plan := PlanQueue(ts, c, map[string]Exposure{"a": {Started: now - 10000}}, now, true); len(plan) != 0 {
		t.Fatal("active demand stopped", plan)
	}
	a.UpSpeed = 0
	ts["a"] = a
	if plan := PlanQueue(ts, c, map[string]Exposure{"a": {Started: now - 1}}, now, true); len(plan) != 0 {
		t.Fatal("minimum exposure ignored", plan)
	}
	if plan := PlanQueue(ts, c, map[string]Exposure{"a": {Started: now - 10000}}, now, true); len(plan) != 2 {
		t.Fatal("idle rotation missing", plan)
	}
}
func FuzzSharedContent(f *testing.F) {
	f.Add("Show-Extra", "Show/a", "Show")
	f.Fuzz(func(t *testing.T, a, b, c string) {
		paths := []string{a, b, c}
		ts := map[string]Torrent{}
		for i, p := range paths {
			if strings.ContainsAny(p, "\x00") || strings.Contains(p, "..") || strings.Contains(p, "//") || strings.HasPrefix(p, "/") || strings.HasSuffix(p, "/") || p == "" || p == "." || path.Clean("/media/"+p) != "/media/"+p {
				return
			}
			ts[fmt.Sprint(i)] = Torrent{ContentPath: "/media/" + p}
		}
		got := SharedContent(ts)
		for i, x := range ts {
			want := false
			for j, y := range ts {
				if i != j && (within(x.ContentPath, y.ContentPath) || within(y.ContentPath, x.ContentPath)) {
					want = true
				}
			}
			if got[i] != want {
				t.Fatalf("%v %+v", ts, got)
			}
		}
	})
}
