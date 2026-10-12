package anibt

import (
	"encoding/json"
	"fmt"
	"math"
	"path"
	"slices"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

var mediaExtensions = splitSet(".mkv,.mp4,.avi,.mov,.webm,.m4v,.ts,.m2ts,.mts,.wmv,.flv,.mpg,.mpeg,.rmvb,.rm,.ogv,.vob,.3gp,.asf,.f4v")

type Tracks struct {
	General  map[string]any   `json:"general"`
	Video    []map[string]any `json:"video"`
	Audio    []map[string]any `json:"audio"`
	Subtitle []map[string]any `json:"subtitle"`
}

func number(v any) float64 {
	x, e := strconv.ParseFloat(fmt.Sprint(v), 64)
	if e != nil || math.IsInf(x, 0) || math.IsNaN(x) {
		return 0
	}
	return x
}
func ParseTracks(b []byte) (Tracks, error) {
	var payload struct {
		Media struct {
			Tracks []map[string]any `json:"track"`
		} `json:"media"`
	}
	out := Tracks{General: map[string]any{}, Video: []map[string]any{}, Audio: []map[string]any{}, Subtitle: []map[string]any{}}
	if json.Unmarshal(b, &payload) != nil {
		return out, fmt.Errorf("invalid MediaInfo JSON")
	}
	truth := func(v any) bool { return slices.Contains([]string{"yes", "true", "1"}, strings.ToLower(fmt.Sprint(v))) }
	for _, t := range payload.Media.Tracks {
		m := map[string]any{"format": "Unknown"}
		if x, ok := t["Format"]; ok {
			m["format"] = x
		}
		copyFields := func(fields map[string]string, numeric bool) {
			for dst, src := range fields {
				if v, ok := t[src]; ok {
					if numeric {
						m[dst] = number(v)
					} else {
						m[dst] = v
					}
				}
			}
		}
		switch t["@type"] {
		case "General":
			m["fileSize"] = number(t["FileSize"])
			m["duration"] = number(t["Duration"])
			copyFields(map[string]string{"overallBitRate": "OverallBitRate"}, true)
			out.General = m
		case "Video":
			m["width"] = number(t["Width"])
			m["height"] = number(t["Height"])
			copyFields(map[string]string{"bitRate": "BitRate", "frameRate": "FrameRate", "bitDepth": "BitDepth"}, true)
			copyFields(map[string]string{"formatProfile": "Format_Profile", "colorSpace": "ColorSpace", "hdrFormat": "HDR_Format"}, false)
			if len(out.Video) < 64 {
				out.Video = append(out.Video, m)
			}
		case "Audio":
			copyFields(map[string]string{"channels": "Channels", "samplingRate": "SamplingRate", "bitRate": "BitRate"}, true)
			copyFields(map[string]string{"channelLayout": "ChannelLayout", "language": "Language", "title": "Title"}, false)
			m["isDefault"] = truth(t["Default"])
			if len(out.Audio) < 64 {
				out.Audio = append(out.Audio, m)
			}
		case "Text":
			copyFields(map[string]string{"language": "Language", "title": "Title"}, false)
			m["isDefault"] = truth(t["Default"])
			m["isForced"] = truth(t["Forced"])
			if len(out.Subtitle) < 64 {
				out.Subtitle = append(out.Subtitle, m)
			}
		}
	}
	if len(out.General) == 0 || (len(out.Video) == 0 && len(out.Audio) == 0) {
		return out, fmt.Errorf("MediaInfo found no media tracks")
	}
	return out, nil
}
func SelectSamples(files []File, limit int) []File {
	if limit <= 0 {
		return nil
	}
	var media []File
	for _, f := range files {
		if mediaExtensions[strings.ToLower(path.Ext(f.Name))] && f.Progress >= 1 {
			media = append(media, f)
		}
	}
	sort.Slice(media, func(i, j int) bool { return media[i].Name < media[j].Name })
	if len(media) <= limit {
		return media
	}
	largest := 0
	for i, f := range media {
		if f.Size > media[largest].Size {
			largest = i
		}
	}
	indices := map[int]bool{largest: true}
	for i := 0; i < limit && len(indices) < limit; i++ {
		indices[int(math.Round(float64(i*(len(media)-1))/float64(max(1, limit-1))))] = true
	}
	for i := 0; len(indices) < limit; i++ {
		indices[i] = true
	}
	out := []File{}
	for i, f := range media {
		if indices[i] {
			out = append(out, f)
		}
	}
	return out
}
func BuildPayload(w MediaWork) ([]byte, error) {
	var representative File
	mediaCount := 0
	var total int64
	for _, f := range w.Files {
		total += f.Size
		if mediaExtensions[strings.ToLower(path.Ext(f.Name))] {
			mediaCount++
		}
		if _, ok := w.Samples[f.Name]; ok && (representative.Name == "" || f.Size > representative.Size) {
			representative = f
		}
	}
	if representative.Name == "" {
		return nil, fmt.Errorf("no usable media samples")
	}
	tracks := w.Samples[representative.Name]
	var p map[string]any
	if e := json.Unmarshal(encode(tracks), &p); e != nil {
		return nil, e
	}
	p["infoHash"] = w.Hash
	p["fileName"] = w.Name
	g := p["general"].(map[string]any)
	var raw strings.Builder
	fmt.Fprintf(&raw, "%s\nFiles: %d; media files: %d; sampled: %d\nRepresentative: %s\n", w.Name, len(w.Files), mediaCount, len(w.Samples), representative.Name)
	if len(w.Files) > 1 {
		g["fileSize"] = total
		delete(g, "overallBitRate")
		if len(w.Samples) == mediaCount {
			duration := 0.0
			for _, t := range w.Samples {
				duration += number(t.General["duration"])
			}
			g["duration"] = duration
		} else {
			delete(g, "duration")
			raw.WriteString("Collection duration is unknown; unsampled files are not extrapolated.\n")
		}
	}
	keys := make([]string, 0, len(w.Samples))
	for k := range w.Samples {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, name := range keys {
		t := w.Samples[name]
		fmt.Fprintf(&raw, "\n%s\n", name)
		parts := []struct {
			name   string
			tracks []map[string]any
		}{{"General", []map[string]any{t.General}}, {"Video", t.Video}, {"Audio", t.Audio}, {"Subtitle", t.Subtitle}}
		for _, part := range parts {
			for _, track := range part.tracks {
				raw.WriteString(part.name + "\n")
				fields := make([]string, 0, len(track))
				for k := range track {
					fields = append(fields, k)
				}
				sort.Strings(fields)
				for _, k := range fields {
					fmt.Fprintf(&raw, "  %s: %v\n", k, track[k])
				}
			}
		}
	}
	raw.WriteString("\nFile list (relative to torrent save directory):\n")
	for _, f := range w.Files {
		fmt.Fprintf(&raw, "%s | %d bytes\n", f.Name, f.Size)
		if raw.Len() > 250000 {
			raw.WriteString("[file list truncated]\n")
			break
		}
	}
	txt := raw.String()
	for {
		p["rawText"] = txt
		b, e := json.Marshal(p)
		if e != nil {
			return nil, e
		}
		if len(b) <= 200000 {
			return b, nil
		}
		if len(txt) == 0 {
			return nil, fmt.Errorf("structured media payload exceeds limit")
		}
		txt = txt[:len(txt)*9/10]
		for !utf8.ValidString(txt) {
			txt = txt[:len(txt)-1]
		}
	}
}
