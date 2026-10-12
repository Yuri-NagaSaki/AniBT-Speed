package anibt

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"
)

func benchmarkHistory(b *testing.B, n int, statsOnly bool) {
	c := testConfig(b)
	c.Notify = false
	s := testStore(b)
	ctx := context.Background()
	must(b, s.tx(ctx, func(tx *sql.Tx) error {
		stmt, e := tx.PrepareContext(ctx, "INSERT INTO receipts VALUES('media',?,'delivered',1)")
		if e != nil {
			return e
		}
		defer stmt.Close()
		for i := 1; i <= n; i++ {
			if _, e = stmt.ExecContext(ctx, fmt.Sprintf("%040x", i)); e != nil {
				return e
			}
		}
		return nil
	}))
	snap := Snapshot{At: time.Now().Unix(), Torrents: map[string]Torrent{}, Server: map[string]float64{"alltime_ul": 100, "alltime_dl": 100}}
	for i := 1; i <= 3000; i++ {
		h := fmt.Sprintf("%040x", i)
		snap.Torrents[h] = Torrent{Hash: h, Name: "Show", Category: c.Category, SavePath: c.QBTRoot, ContentPath: c.QBTRoot + "/" + h, Progress: 1, State: "stoppedUP", CompletedAt: 1}
	}
	_, e := s.Observe(ctx, snap, nil, c)
	must(b, e)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if statsOnly {
			_, e = s.Stats(ctx)
		} else {
			_, e = s.Observe(ctx, snap, snap.Torrents, c)
		}
		if e != nil {
			b.Fatal(e)
		}
	}
}
func BenchmarkObserveHistory(b *testing.B) {
	for _, n := range []int{10000, 100000, 300000} {
		b.Run(fmt.Sprint(n), func(b *testing.B) { benchmarkHistory(b, n, false) })
	}
}
func BenchmarkStatsHistory(b *testing.B) {
	for _, n := range []int{10000, 100000, 300000} {
		b.Run(fmt.Sprint(n), func(b *testing.B) { benchmarkHistory(b, n, true) })
	}
}
