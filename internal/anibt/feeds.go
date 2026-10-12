package anibt

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

var slugPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

type RSS struct {
	XMLName xml.Name  `xml:"rss"`
	Items   []RSSItem `xml:"channel>item"`
}
type RSSItem struct {
	Title        string `xml:"title"`
	Link         string `xml:"link"`
	GUID         string `xml:"guid"`
	Date         string `xml:"pubDate"`
	Release      string `xml:"https://anibt.net/xmlns/rss/1.0/ releaseId"`
	Torrent      string `xml:"https://anibt.net/xmlns/rss/1.0/ torrentUrl"`
	Slug         string `xml:"https://anibt.net/xmlns/rss/1.0/ groupSlug"`
	Group        string `xml:"https://anibt.net/xmlns/rss/1.0/ groupName"`
	Anime        string `xml:"https://anibt.net/xmlns/rss/1.0/ animeTitle"`
	English      string `xml:"https://anibt.net/xmlns/rss/1.0/ animeTitleEnglish"`
	Bgm          string `xml:"https://anibt.net/xmlns/rss/1.0/ bgmId"`
	ReleaseTitle string `xml:"https://anibt.net/xmlns/rss/1.0/ releaseTitle"`
	Enclosures   []struct {
		URL string `xml:"url,attr"`
	} `xml:"enclosure"`
}

func parseFeed(b []byte, f Feed, c Config, now time.Time) ([]Entry, error) {
	var rss RSS
	if e := xml.Unmarshal(b, &rss); e != nil {
		return nil, fmt.Errorf("invalid RSS XML")
	}
	entries := []Entry{}
	for _, v := range rss.Items {
		d := Download{Key: strings.TrimSpace(v.Release), Title: v.ReleaseTitle, Slug: v.Slug, GroupName: v.Group, Anime: v.Anime, BgmID: v.Bgm}
		if d.Key == "" {
			d.Key = v.GUID
		}
		if strings.Contains(d.Key, "/release/") {
			d.Key = path.Base(d.Key)
		}
		if d.Title == "" {
			d.Title = v.Title
		}
		if d.Slug == "" {
			d.Slug = f.Slug
		}
		if d.GroupName == "" {
			d.GroupName = f.Name
		}
		if d.Anime == "" {
			d.Anime = v.English
		}
		candidates := []string{v.Torrent}
		for _, x := range v.Enclosures {
			candidates = append(candidates, x.URL)
		}
		candidates = append(candidates, v.Link)
		for _, x := range candidates {
			u, e := url.Parse(x)
			if e == nil && ((u.Scheme == "magnet") || ((u.Scheme == "http" || u.Scheme == "https") && u.Host != "" && u.User == nil && strings.HasSuffix(u.Path, ".torrent"))) {
				d.URL = x
				break
			}
		}
		if d.Key == "" {
			d.Key = d.URL
		}
		if d.Key == "" || d.URL == "" {
			continue
		}
		for _, layout := range []string{time.RFC1123Z, time.RFC1123, time.RFC3339, time.RFC822Z} {
			if ts, e := time.Parse(layout, v.Date); e == nil {
				d.Published = ts.Unix()
				break
			}
		}
		if (d.Published == 0 && c.FeedMaxAge > 0) || d.Published > now.Add(5*time.Minute).Unix() {
			continue
		}
		entry := Entry{Download: d}
		switch {
		case d.Slug != f.Slug:
			entry.Reject = "group identity mismatch"
			entry.ScopeOnly = true
		case c.excluded(d.Slug):
			entry.Reject = "excluded group"
		case c.FeedMaxAge > 0 && d.Published < now.Add(-c.FeedMaxAge).Unix():
			entry.Reject = "release too old"
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

type seasonCache struct {
	Until time.Time
	Label string
}
type Feeds struct {
	c        Config
	s        *Store
	http     *http.Client
	lastSync time.Time
	seasons  map[string]seasonCache
}

func NewFeeds(c Config, s *Store) *Feeds {
	return &Feeds{c: c, s: s, http: newHTTP(c.FeedConcurrency+1, true), seasons: map[string]seasonCache{}}
}
func (f *Feeds) fetch(ctx context.Context, endpoint string, headers map[string]string) ([]byte, http.Header, int, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	return request(ctx, f.http, "AniBT source", "GET", endpoint, nil, headers, 8<<20)
}
func (f *Feeds) sync(ctx context.Context) error {
	b, _, _, e := f.fetch(ctx, strings.TrimRight(f.c.APIRoot, "/")+"/api/subtitle-groups", nil)
	if e != nil {
		return e
	}
	var payload struct{ Data []struct{ Slug, Name string } }
	if json.Unmarshal(b, &payload) != nil || len(payload.Data) == 0 {
		return fmt.Errorf("invalid subtitle group response")
	}
	groups := map[string]string{}
	for _, g := range payload.Data {
		if !slugPattern.MatchString(g.Slug) || g.Name == "" {
			return fmt.Errorf("invalid subtitle group identity")
		}
		groups[g.Slug] = g.Name
	}
	if e = f.s.SyncFeeds(ctx, groups, f.c); e == nil {
		f.lastSync = time.Now()
	}
	return e
}
func (f *Feeds) Poll(ctx context.Context) error {
	var syncErr error
	if time.Since(f.lastSync) >= f.c.FeedSync {
		syncErr = f.sync(ctx)
	}
	feeds, e := f.s.Feeds(ctx)
	if e != nil {
		return e
	}
	if len(feeds) == 0 {
		return fmt.Errorf("no enabled feeds")
	}
	work := make(chan Feed)
	var wg sync.WaitGroup
	var mu sync.Mutex
	failures := 0
	for i := 0; i < f.c.FeedConcurrency; i++ {
		wg.Go(func() {
			for feed := range work {
				if f.c.excluded(feed.Slug) {
					continue
				}
				e := f.pollOne(ctx, feed)
				if e != nil {
					mu.Lock()
					failures++
					mu.Unlock()
					settle(func(cx context.Context) error { return f.s.FeedError(cx, feed.Slug, e) })
				}
			}
		})
	}
	for _, feed := range feeds {
		select {
		case work <- feed:
		case <-ctx.Done():
			close(work)
			wg.Wait()
			return ctx.Err()
		}
	}
	close(work)
	wg.Wait()
	if syncErr != nil {
		return syncErr
	}
	if failures > 0 {
		return fmt.Errorf("%d feeds deferred", failures)
	}
	return nil
}
func (f *Feeds) pollOne(ctx context.Context, feed Feed) error {
	headers := map[string]string{}
	if feed.Initialized {
		if feed.ETag != "" {
			headers["If-None-Match"] = feed.ETag
		}
		if feed.Modified != "" {
			headers["If-Modified-Since"] = feed.Modified
		}
	}
	b, h, status, e := f.fetch(ctx, strings.TrimRight(f.c.APIRoot, "/")+"/rss/group/"+url.PathEscape(feed.Slug)+".xml?limit="+fmt.Sprint(f.c.FeedLimit), headers)
	if e != nil {
		return e
	}
	if status == 304 {
		if !feed.Initialized {
			return fmt.Errorf("uninitialized feed returned 304")
		}
		return f.s.Ingest(ctx, feed, nil, feed.ETag, feed.Modified, false)
	}
	entries, e := parseFeed(b, feed, f.c, time.Now())
	if e != nil {
		return e
	}
	return f.s.Ingest(ctx, feed, entries, h.Get("ETag"), h.Get("Last-Modified"), f.c.Bootstrap && !feed.Initialized)
}
func (f *Feeds) season(ctx context.Context, id string) (string, error) {
	if id == "" {
		return "", nil
	}
	for _, r := range id {
		if r < '0' || r > '9' {
			return "", nil
		}
	}
	if x, ok := f.seasons[id]; ok && time.Now().Before(x.Until) {
		return x.Label, nil
	}
	b, _, _, e := f.fetch(ctx, strings.TrimRight(f.c.APIRoot, "/")+"/api/seasons/anime?bgmId="+url.QueryEscape(id), nil)
	if e != nil {
		return "", e
	}
	var payload struct {
		Data *struct {
			Season string `json:"requestedSeason"`
		}
	}
	if json.Unmarshal(b, &payload) != nil {
		return "", fmt.Errorf("invalid season response")
	}
	label := ""
	if payload.Data != nil {
		label = payload.Data.Season
	}
	if len(f.seasons) >= 4096 {
		clear(f.seasons)
	}
	f.seasons[id] = seasonCache{time.Now().Add(time.Hour), label}
	return label, nil
}
func (f *Feeds) Prepare(ctx context.Context) error {
	for i := 0; i < f.c.PrepareBatch; i++ {
		t, e := f.s.Claim(ctx, "download", []string{"pending"}, 2*time.Minute)
		if e != nil {
			return e
		}
		if t == nil {
			return nil
		}
		e = f.prepareOne(ctx, *t)
		if e != nil {
			settle(func(cx context.Context) error { return f.s.Retry(cx, *t, e, retryDelay(e)) })
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return nil
}
func (f *Feeds) prepareOne(ctx context.Context, t Task) error {
	ctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	var d Download
	if e := json.Unmarshal(t.Data, &d); e != nil {
		return fmt.Errorf("invalid download data")
	}
	if f.c.excluded(d.Slug) || (f.c.FeedMaxAge > 0 && d.Published > 0 && time.Now().Unix()-d.Published > int64(f.c.FeedMaxAge/time.Second)) {
		return f.s.Finish(ctx, t, "release", d.Key, "policy rejected", "")
	}
	var season string
	var e error
	if d.Slug != "ktnbytes" {
		season, e = f.season(ctx, d.BgmID)
		if e != nil {
			return e
		}
	}
	var size int64
	if strings.HasPrefix(d.URL, "magnet:") {
		if f.c.MaxTorrentGiB > 0 {
			return fmt.Errorf("magnet size cannot be verified")
		}
		d.Hash, e = MagnetHash(d.URL)
	} else {
		d.Content, _, _, e = f.fetch(ctx, d.URL, nil)
		if e == nil {
			d.Hash, size, e = TorrentIdentity(d.Content)
		}
	}
	if e != nil {
		return e
	}
	if f.c.MaxTorrentGiB > 0 && float64(size) > f.c.MaxTorrentGiB*(1<<30) {
		return f.s.Finish(ctx, t, "release", d.Key, "size policy", "")
	}
	d.SavePath, d.Tags = layout(d, season, f.c)
	return f.s.Ready(ctx, t, d)
}

var badComponent = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]`)

func component(s string) string {
	s = badComponent.ReplaceAllString(s, "_")
	s = strings.ReplaceAll(strings.Join(strings.Fields(s), " "), ",", "，")
	s = strings.Trim(s, " .")
	for len(s) > 200 {
		_, n := utf8.DecodeLastRuneInString(s)
		s = s[:len(s)-n]
	}
	if s == "" {
		return "其他"
	}
	return s
}

var seasonPattern = regexp.MustCompile(`(?i)^(\d{4})\s*[-_/]?\s*(春季?|夏季?|秋季?|冬季?|WINTER|SPRING|SUMMER|FALL|AUTUMN)$`)

func layout(d Download, season string, c Config) (string, string) {
	label := "其他"
	if m := seasonPattern.FindStringSubmatch(strings.TrimSpace(season)); m != nil {
		names := map[string]string{"WINTER": "冬季", "SPRING": "春季", "SUMMER": "夏季", "FALL": "秋季", "AUTUMN": "秋季"}
		part := names[strings.ToUpper(m[2])]
		if part == "" {
			part = string([]rune(m[2])[0]) + "季"
		}
		label = m[1] + part
	}
	group := d.GroupName
	if group == "" {
		group = d.Slug
	}
	group = component(group)
	title := d.Anime
	if title == "" {
		title = d.Title
	}
	p := path.Join(c.QBTRoot, group, label, component(title), d.Hash)
	if d.Slug == "ktnbytes" {
		label = "合集"
		p = path.Join(c.QBTRoot, group, label, d.Hash)
	}
	return p, "AniBT,字幕组:" + group + ",group:" + d.Slug + ",季度:" + label
}
