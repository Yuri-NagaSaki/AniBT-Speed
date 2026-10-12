package anibt

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// QBT belongs exclusively to Controller. No other work lane calls this adapter.
type QBT struct {
	c                                      Config
	http                                   *http.Client
	rid                                    int64
	torrents                               map[string]Torrent
	server                                 map[string]json.RawMessage
	categories                             map[string]bool
	Requests, Failures, Bytes, Full, Delta int64
	ReadOnly                               bool
}

func NewQBT(c Config, readOnly bool) *QBT {
	return &QBT{c: c, http: newHTTP(1, false), ReadOnly: readOnly}
}
func (q *QBT) call(ctx context.Context, method, endpoint string, body []byte, contentType string) (b []byte, e error) {
	if q.ReadOnly && method != "GET" {
		return nil, fmt.Errorf("qB mutation forbidden during preflight")
	}
	ctx, cancel := context.WithTimeout(ctx, q.c.QBTTimeout)
	defer cancel()
	q.Requests++
	headers := map[string]string{"Authorization": "Bearer " + q.c.QBTKey}
	if contentType != "" {
		headers["Content-Type"] = contentType
	}
	b, _, _, e = request(ctx, q.http, "qB", method, strings.TrimRight(q.c.QBTURL, "/")+"/api/v2/"+endpoint, bytes.NewReader(body), headers, 64<<20)
	q.Bytes += int64(len(b))
	if e != nil {
		q.Failures++
	}
	return
}
func (q *QBT) Snapshot(ctx context.Context) (Snapshot, error) {
	b, e := q.call(ctx, "GET", "sync/maindata?rid="+strconv.FormatInt(q.rid, 10), nil, "")
	if e != nil {
		return Snapshot{}, e
	}
	var d struct {
		RID               *int64                                `json:"rid"`
		Full              bool                                  `json:"full_update"`
		Torrents          map[string]map[string]json.RawMessage `json:"torrents"`
		Removed           []string                              `json:"torrents_removed"`
		Server            map[string]json.RawMessage            `json:"server_state"`
		Categories        map[string]json.RawMessage            `json:"categories"`
		CategoriesRemoved []string                              `json:"categories_removed"`
	}
	bad := func() (Snapshot, error) {
		q.rid = 0
		return Snapshot{}, fmt.Errorf("invalid qB snapshot; full refresh required")
	}
	if e = json.Unmarshal(b, &d); e != nil || d.RID == nil || *d.RID < 0 || (q.rid == 0 && !d.Full) {
		return bad()
	}
	if d.Full {
		q.torrents = map[string]Torrent{}
		q.server = map[string]json.RawMessage{}
		q.categories = map[string]bool{}
	}
	for h, fields := range d.Torrents {
		if !hashPattern.MatchString(h) || fields == nil {
			return bad()
		}
		t := q.torrents[h]
		if json.Unmarshal(encode(fields), &t) != nil || t.State == "" {
			return bad()
		}
		t.Hash = h
		q.torrents[h] = t
	}
	for _, h := range d.Removed {
		delete(q.torrents, h)
	}
	for k, v := range d.Server {
		q.server[k] = v
	}
	for k := range d.Categories {
		q.categories[k] = true
	}
	for _, k := range d.CategoriesRemoved {
		delete(q.categories, k)
	}
	s := Snapshot{Torrents: map[string]Torrent{}, Server: map[string]float64{}, Categories: map[string]bool{}, At: time.Now().Unix()}
	for h, t := range q.torrents {
		s.Torrents[h] = t
	}
	for k, v := range q.server {
		var n float64
		if json.Unmarshal(v, &n) == nil {
			s.Server[k] = n
		}
	}
	for k := range q.categories {
		s.Categories[k] = true
	}
	q.rid = *d.RID
	if d.Full {
		q.Full++
	} else {
		q.Delta++
	}
	return s, nil
}
func (q *QBT) form(ctx context.Context, endpoint string, fields url.Values) ([]byte, error) {
	return q.call(ctx, "POST", endpoint, []byte(fields.Encode()), "application/x-www-form-urlencoded")
}
func (q *QBT) Execute(ctx context.Context, c Command) error {
	var e error
	switch c.Kind {
	case "start", "stop":
		_, e = q.form(ctx, "torrents/"+c.Kind, url.Values{"hashes": {strings.Join(c.Hashes, "|")}})
	case "delete":
		_, e = q.form(ctx, "torrents/delete", url.Values{"hashes": {strings.Join(c.Hashes, "|")}, "deleteFiles": {"true"}})
	case "category":
		_, e = q.form(ctx, "torrents/createCategory", url.Values{"category": {q.c.Category}, "savePath": {q.c.QBTRoot}})
	case "upload", "download":
		endpoint := "setUploadLimit"
		if c.Kind == "download" {
			endpoint = "setDownloadLimit"
		}
		_, e = q.form(ctx, "transfer/"+endpoint, url.Values{"limit": {strconv.FormatInt(c.Limit, 10)}})
	default:
		e = fmt.Errorf("unknown qB command")
	}
	return e
}
func (q *QBT) Add(ctx context.Context, d Download) error {
	fields := map[string]string{"savepath": d.SavePath, "category": q.c.Category, "tags": d.Tags, "autoTMM": "false"}
	var b []byte
	var e error
	if len(d.Content) > 0 {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		for k, v := range fields {
			if e = writer.WriteField(k, v); e != nil {
				return e
			}
		}
		part, e := writer.CreateFormFile("torrents", "release.torrent")
		if e != nil {
			return e
		}
		if _, e = part.Write(d.Content); e != nil {
			return e
		}
		if e = writer.Close(); e != nil {
			return e
		}
		b, e = q.call(ctx, "POST", "torrents/add", body.Bytes(), writer.FormDataContentType())
	} else {
		form := url.Values{"urls": {d.URL}}
		for k, v := range fields {
			form.Set(k, v)
		}
		b, e = q.form(ctx, "torrents/add", form)
	}
	if e != nil {
		return e
	}
	var ack struct {
		Success int      `json:"success_count"`
		Failure int      `json:"failure_count"`
		Pending int      `json:"pending_count"`
		Hashes  []string `json:"added_torrent_ids"`
	}
	if json.Unmarshal(b, &ack) != nil {
		return fmt.Errorf("invalid qB add acknowledgement")
	}
	matched := false
	for _, h := range ack.Hashes {
		if strings.EqualFold(h, d.Hash) {
			matched = true
		}
	}
	if ack.Failure != 0 || !(ack.Pending > 0 || (ack.Success > 0 && matched)) {
		return fmt.Errorf("qB did not acknowledge the expected hash")
	}
	return nil
}
func (q *QBT) Files(ctx context.Context, hash string) ([]File, error) {
	if !hashPattern.MatchString(hash) {
		return nil, fmt.Errorf("invalid hash")
	}
	b, e := q.call(ctx, "GET", "torrents/files?hash="+hash, nil, "")
	if e != nil {
		return nil, e
	}
	var files []File
	if json.Unmarshal(b, &files) != nil || len(files) > 50000 || len(files) == 0 {
		return nil, fmt.Errorf("invalid qB file manifest")
	}
	for _, f := range files {
		if f.Name == "" || f.Size < 0 {
			return nil, fmt.Errorf("invalid qB file")
		}
	}
	return files, nil
}
