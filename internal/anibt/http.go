package anibt

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"time"
)

type HTTPError struct {
	Service string
	Status  int
	After   time.Duration
}

func (e *HTTPError) Error() string { return fmt.Sprintf("%s HTTP %d", e.Service, e.Status) }
func newHTTP(concurrency int, redirects bool) *http.Client {
	return &http.Client{Transport: &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 3 * time.Second, KeepAlive: 30 * time.Second}).DialContext, MaxConnsPerHost: concurrency, MaxIdleConns: concurrency * 4, MaxIdleConnsPerHost: concurrency, IdleConnTimeout: 90 * time.Second, TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 15 * time.Second}, CheckRedirect: func(r *http.Request, via []*http.Request) error {
		if !redirects {
			return http.ErrUseLastResponse
		}
		if len(via) >= 5 {
			return fmt.Errorf("too many redirects")
		}
		return nil
	}}
}
func request(ctx context.Context, client *http.Client, service, method, endpoint string, body io.Reader, headers map[string]string, limit int64) ([]byte, http.Header, int, error) {
	req, e := http.NewRequestWithContext(ctx, method, endpoint, body)
	if e != nil {
		return nil, nil, 0, fmt.Errorf("invalid %s request", service)
	}
	req.Header.Set("User-Agent", "AniBT/2.0")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, e := client.Do(req)
	if e != nil {
		if ctx.Err() != nil {
			return nil, nil, 0, ctx.Err()
		}
		return nil, nil, 0, fmt.Errorf("%s transport unavailable", service)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotModified {
		return nil, res.Header, res.StatusCode, nil
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		after := time.Duration(0)
		if n, e := strconv.Atoi(res.Header.Get("Retry-After")); e == nil {
			after = time.Duration(n) * time.Second
		} else if at, e := http.ParseTime(res.Header.Get("Retry-After")); e == nil {
			after = max(0, time.Until(at))
		}
		b, _ := io.ReadAll(io.LimitReader(res.Body, 8192))
		return b, res.Header, res.StatusCode, &HTTPError{service, res.StatusCode, after}
	}
	b, e := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if e != nil {
		return nil, nil, res.StatusCode, fmt.Errorf("%s response interrupted", service)
	}
	if int64(len(b)) > limit {
		return nil, nil, res.StatusCode, fmt.Errorf("%s response exceeds limit", service)
	}
	return b, res.Header, res.StatusCode, nil
}
func retryDelay(e error) time.Duration {
	var h *HTTPError
	if errors.As(e, &h) {
		d := h.After
		if h.Status == 401 || h.Status == 403 || h.Status == 404 || h.Status == 422 {
			d = max(d, time.Hour)
		}
		return d
	}
	return 0
}
