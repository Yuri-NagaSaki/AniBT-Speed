package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	app "github.com/Yuri-NagaSaki/AniBT-Speed/internal/anibt"
)

func printJSON(v any) error {
	b, e := json.MarshalIndent(v, "", "  ")
	if e != nil {
		return e
	}
	fmt.Println(string(b))
	return nil
}
func main() {
	if e := mainE(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
func mainE() error {
	flags := flag.NewFlagSet("anibt", flag.ContinueOnError)
	config := flags.String("config", "", "configuration file; ANIBT_* environment overrides it")
	if e := flags.Parse(os.Args[1:]); e != nil {
		return e
	}
	args := flags.Args()
	if len(args) == 0 {
		return fmt.Errorf("usage: anibt [--config FILE] run|status|check|queue|archives|retry|replay|cancel|diagnose|recover|backup|import-v1|upgrade-state|version")
	}
	if args[0] == "version" {
		return printJSON(map[string]string{"version": app.Version, "revision": app.Revision})
	}
	c, e := app.LoadConfig(*config)
	if e != nil {
		return e
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	switch args[0] {
	case "run":
		f := flag.NewFlagSet("run", flag.ContinueOnError)
		activation := f.String("activation", "", "require a file containing this build revision")
		if e = f.Parse(args[1:]); e != nil {
			return e
		}
		return app.Run(ctx, c, *activation)
	case "status":
		b, e := os.ReadFile(filepath.Join(c.StateDir, "status.json"))
		if e != nil {
			return e
		}
		var s struct {
			Status  string `json:"status"`
			Updated int64  `json:"updated_at"`
		}
		if e = json.Unmarshal(b, &s); e != nil {
			return e
		}
		fmt.Println(string(b))
		if time.Now().Unix()-s.Updated > 20 {
			return fmt.Errorf("status heartbeat is stale")
		}
		if s.Status != "ok" && s.Status != "ready" {
			return fmt.Errorf("worker status: %s", s.Status)
		}
		return nil
	case "check":
		ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
		defer cancel()
		snap, e := app.Preflight(ctx, c)
		if e != nil {
			return e
		}
		return printJSON(map[string]any{"revision": app.Revision, "preflight": "passed", "torrents": len(snap.Torrents)})
	case "upgrade-state":
		return app.UpgradeState(ctx, c)
	case "import-v1":
		if len(args) != 2 {
			return fmt.Errorf("import-v1 requires an offline v1 SQLite snapshot")
		}
		lock, e := app.Lock(c.StateDir)
		if e != nil {
			return e
		}
		defer lock.Close()
		return app.ImportV1(ctx, c, args[1])
	case "diagnose", "recover":
		return app.DiagnoseCLI(ctx, c, args[0], args[1:])
	}
	s, e := app.OpenStore(filepath.Join(c.StateDir, "state.sqlite3"), c.Notify, c.MaxAttempts)
	if e != nil {
		return e
	}
	defer s.Close()
	switch args[0] {
	case "archives":
		records, e := s.Archives(ctx)
		if e != nil {
			return e
		}
		return printJSON(records)
	case "queue":
		lane := ""
		if len(args) > 1 {
			lane = args[1]
		}
		q, e := s.Queue(ctx, lane)
		if e != nil {
			return e
		}
		return printJSON(q)
	case "backup":
		if len(args) != 2 {
			return fmt.Errorf("backup requires a new destination file")
		}
		return s.Backup(ctx, args[1])
	case "retry", "replay", "cancel":
		if len(args) != 2 {
			return fmt.Errorf("%s requires one exact task id or release id", args[0])
		}
		return s.Operate(ctx, args[0], args[1])
	default:
		return fmt.Errorf("unknown command %s", args[0])
	}
}
