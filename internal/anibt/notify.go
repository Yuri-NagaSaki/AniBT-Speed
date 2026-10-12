package anibt

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type Notification struct {
	Text    string `json:"text"`
	Summary string `json:"summary,omitempty"`
}
type Notifier struct {
	c    Config
	s    *Store
	http *http.Client
	base string
}

func NewNotifier(c Config, s *Store) *Notifier {
	return &Notifier{c: c, s: s, http: newHTTP(1, false), base: "https://api.telegram.org"}
}
func (n *Notifier) Step(ctx context.Context) error {
	t, e := n.s.Claim(ctx, "notify", []string{"send"}, time.Minute)
	if e != nil {
		return e
	}
	if t == nil {
		return nil
	}
	e = n.one(ctx, *t)
	if e != nil {
		settle(func(cx context.Context) error { return n.s.Retry(cx, *t, e, retryDelay(e)) })
		return e
	}
	return nil
}
func (n *Notifier) one(ctx context.Context, t Task) error {
	var msg Notification
	if json.Unmarshal(t.Data, &msg) != nil {
		return fmt.Errorf("invalid notification")
	}
	text := []rune(msg.Text)
	if len(text) > 3500 {
		text = text[:3500]
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	b, _, status, e := request(ctx, n.http, "Telegram", "POST", n.base+"/bot"+n.c.NotifyToken+"/sendMessage", bytes.NewReader(encode(map[string]any{"chat_id": n.c.NotifyChat, "text": string(text)})), map[string]string{"Content-Type": "application/json"}, 1<<20)
	var response struct {
		OK         bool `json:"ok"`
		Code       int  `json:"error_code"`
		Parameters struct {
			After int `json:"retry_after"`
		} `json:"parameters"`
	}
	decodeErr := json.Unmarshal(b, &response)
	if decodeErr == nil && response.Parameters.After > 0 {
		return &HTTPError{"Telegram", max(status, response.Code), time.Duration(response.Parameters.After) * time.Second}
	}
	if e != nil {
		return e
	}
	if decodeErr != nil || !response.OK {
		return fmt.Errorf("Telegram did not acknowledge notification")
	}
	kind, key := "notification", t.Key
	if msg.Summary != "" {
		kind, key = "summary", msg.Summary
	}
	return n.s.Finish(ctx, t, kind, key, "delivered", "")
}
