package anibt

import (
	"bytes"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
)

func MagnetHash(s string) (string, error) {
	u, e := url.Parse(s)
	if e != nil || u.Scheme != "magnet" {
		return "", fmt.Errorf("invalid magnet")
	}
	for _, v := range u.Query()["xt"] {
		if strings.HasPrefix(strings.ToLower(v), "urn:btih:") {
			h := v[9:]
			if len(h) == 40 {
				b, e := hex.DecodeString(h)
				if e == nil {
					return hex.EncodeToString(b), nil
				}
			}
			if len(h) == 32 {
				b, e := base32.StdEncoding.DecodeString(strings.ToUpper(h))
				if e == nil {
					return hex.EncodeToString(b), nil
				}
			}
		}
		if strings.HasPrefix(v, "urn:btmh:1220") && len(v) == 77 {
			b, e := hex.DecodeString(v[13:])
			if e == nil {
				return hex.EncodeToString(b)[:40], nil
			}
		}
	}
	return "", fmt.Errorf("unsupported magnet identity")
}

type bdecoder struct {
	data       []byte
	pos, nodes int
	info       []byte
}

func (d *bdecoder) value(depth int) (any, error) {
	d.nodes++
	bad := fmt.Errorf("invalid torrent bencode")
	if depth > 32 || d.nodes > 200000 || d.pos >= len(d.data) {
		return nil, bad
	}
	ch := d.data[d.pos]
	d.pos++
	switch ch {
	case 'i':
		end := bytes.IndexByte(d.data[d.pos:], 'e')
		if end < 0 {
			return nil, bad
		}
		raw := string(d.data[d.pos : d.pos+end])
		n, e := strconv.ParseInt(raw, 10, 64)
		if e != nil || strconv.FormatInt(n, 10) != raw {
			return nil, bad
		}
		d.pos += end + 1
		return n, nil
	case 'l', 'd':
		list := []any{}
		dict := map[string]any{}
		for d.pos < len(d.data) && d.data[d.pos] != 'e' {
			if ch == 'l' {
				v, e := d.value(depth + 1)
				if e != nil {
					return nil, e
				}
				list = append(list, v)
			} else {
				k, e := d.value(depth + 1)
				if e != nil {
					return nil, e
				}
				key, ok := k.(string)
				if !ok {
					return nil, bad
				}
				if _, ok = dict[key]; ok {
					return nil, bad
				}
				start := d.pos
				v, e := d.value(depth + 1)
				if e != nil {
					return nil, e
				}
				dict[key] = v
				if depth == 0 && key == "info" {
					d.info = d.data[start:d.pos]
				}
			}
		}
		if d.pos >= len(d.data) {
			return nil, bad
		}
		d.pos++
		if ch == 'l' {
			return list, nil
		}
		return dict, nil
	default:
		if ch < '0' || ch > '9' {
			return nil, bad
		}
		d.pos--
		colon := bytes.IndexByte(d.data[d.pos:], ':')
		if colon < 1 || colon > 10 {
			return nil, bad
		}
		raw := string(d.data[d.pos : d.pos+colon])
		n, e := strconv.Atoi(raw)
		if e != nil || n < 0 || strconv.Itoa(n) != raw || n > len(d.data)-d.pos-colon-1 {
			return nil, bad
		}
		d.pos += colon + 1
		v := string(d.data[d.pos : d.pos+n])
		d.pos += n
		return v, nil
	}
}
func TorrentIdentity(b []byte) (string, int64, error) {
	d := bdecoder{data: b}
	v, e := d.value(0)
	bad := fmt.Errorf("invalid torrent metadata")
	if e != nil || d.pos != len(b) {
		return "", 0, bad
	}
	root, ok := v.(map[string]any)
	if !ok {
		return "", 0, bad
	}
	info, ok := root["info"].(map[string]any)
	if !ok || len(d.info) == 0 {
		return "", 0, bad
	}
	var size int64
	add := func(v any) bool {
		n, ok := v.(int64)
		if !ok || n < 0 || n > math.MaxInt64-size {
			return false
		}
		size += n
		return true
	}
	if files, ok := info["files"].([]any); ok {
		if len(files) == 0 {
			return "", 0, bad
		}
		for _, f := range files {
			m, ok := f.(map[string]any)
			if !ok || !add(m["length"]) {
				return "", 0, bad
			}
		}
	} else if n, ok := info["length"]; ok {
		if !add(n) {
			return "", 0, bad
		}
	} else if info["meta version"] == int64(2) {
		var sum func(any) bool
		sum = func(v any) bool {
			m, ok := v.(map[string]any)
			if !ok {
				return false
			}
			for k, x := range m {
				if k == "" {
					leaf, ok := x.(map[string]any)
					if !ok || !add(leaf["length"]) {
						return false
					}
				} else if !sum(x) {
					return false
				}
			}
			return true
		}
		if !sum(info["file tree"]) {
			return "", 0, bad
		}
	} else {
		return "", 0, bad
	}
	if info["meta version"] == int64(2) && info["pieces"] == nil {
		h := sha256.Sum256(d.info)
		return hex.EncodeToString(h[:])[:40], size, nil
	}
	h := sha1.Sum(d.info)
	return hex.EncodeToString(h[:]), size, nil
}
