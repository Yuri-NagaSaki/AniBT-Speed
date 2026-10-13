package anibt

import (
	"bufio"
	"fmt"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"time"
)

// Config has one namespace and no legacy aliases. Durations include units (30s, 12h).
type Config struct {
	QBTURL           string        `env:"QBT_URL" default:"http://127.0.0.1:8181"`
	QBTKey           string        `env:"QBT_API_KEY"`
	APIRoot          string        `env:"API_URL" default:"https://anibt.net"`
	APIToken         string        `env:"API_TOKEN"`
	StateDir         string        `env:"STATE_DIR" default:"/var/lib/anibt"`
	QBTRoot          string        `env:"QBT_DOWNLOAD_ROOT" default:"/media/AniBT"`
	MediaRoot        string        `env:"MEDIA_ROOT" default:"/hdd/media/AniBT"`
	Category         string        `env:"CATEGORY" default:"AniBT"`
	ExcludedTags     string        `env:"PROTECTED_TAGS" default:"keep"`
	ExcludedGroups   string        `env:"EXCLUDED_GROUPS" default:"kirara-fantasia,ani,zzz123,pre-s,silent-workshop,geckyzz"`
	ControlInterval  time.Duration `env:"CONTROL_INTERVAL" default:"30s"`
	ControlBudget    time.Duration `env:"CONTROL_BUDGET" default:"20s"`
	Commands         int           `env:"CONTROL_COMMANDS" default:"8"`
	QBTTimeout       time.Duration `env:"QBT_TIMEOUT" default:"8s"`
	FeedInterval     time.Duration `env:"FEED_INTERVAL" default:"5m"`
	FeedSync         time.Duration `env:"FEED_SYNC_INTERVAL" default:"12h"`
	FeedConcurrency  int           `env:"FEED_CONCURRENCY" default:"3"`
	FeedLimit        int           `env:"FEED_LIMIT" default:"100"`
	FeedMaxAge       time.Duration `env:"RELEASE_MAX_AGE" default:"48h"`
	Bootstrap        bool          `env:"BOOTSTRAP_HISTORY" default:"true"`
	Feeds            bool          `env:"FEEDS_ENABLED" default:"true"`
	PrepareBatch     int           `env:"PREPARE_BATCH" default:"4"`
	AddBatch         int           `env:"ADD_BATCH" default:"3"`
	ConfirmTimeout   time.Duration `env:"CONFIRM_TIMEOUT" default:"2m"`
	StallTimeout     time.Duration `env:"STALL_TIMEOUT" default:"6h"`
	MaxTorrentGiB    float64       `env:"MAX_TORRENT_GIB" default:"0"`
	Pool             bool          `env:"POOL_ENABLED" default:"true"`
	PoolTarget       int           `env:"POOL_TARGET" default:"300"`
	PoolBatch        int           `env:"POOL_BATCH" default:"40"`
	RotationBatch    int           `env:"ROTATION_BATCH" default:"10"`
	RotationInterval time.Duration `env:"ROTATION_INTERVAL" default:"3m"`
	Exposure         time.Duration `env:"EXPOSURE" default:"10m"`
	Hot              time.Duration `env:"HOT_WINDOW" default:"12h"`
	Cleanup          bool          `env:"CLEANUP_ENABLED" default:"true"`
	CleanupInterval  time.Duration `env:"CLEANUP_INTERVAL" default:"5m"`
	CleanupBatch     int           `env:"CLEANUP_BATCH" default:"5"`
	Protect          time.Duration `env:"CLEANUP_PROTECT" default:"8h"`
	RetainDays       int           `env:"RETAIN_DAYS" default:"90"`
	MinFreeGiB       float64       `env:"MIN_FREE_GIB" default:"100"`
	MaxDiskPercent   float64       `env:"MAX_DISK_PERCENT" default:"85"`
	Rate             bool          `env:"RATE_ENABLED" default:"false"`
	UploadMiB        float64       `env:"UPLOAD_MIB" default:"100"`
	BusyUploadMiB    float64       `env:"DOWNLOADING_UPLOAD_MIB" default:"80"`
	DownloadMiB      float64       `env:"DOWNLOAD_MIB" default:"60"`
	HourlyGiB        float64       `env:"HOURLY_UPLOAD_GIB" default:"0"`
	DailyGiB         float64       `env:"DAILY_UPLOAD_GIB" default:"0"`
	HistoryDays      int           `env:"HISTORY_DAYS" default:"90"`
	Media            bool          `env:"MEDIA_ENABLED" default:"true"`
	MediaInterval    time.Duration `env:"MEDIA_INTERVAL" default:"5s"`
	MediaSamples     int           `env:"MEDIA_SAMPLES" default:"6"`
	MediaTimeout     time.Duration `env:"MEDIA_TIMEOUT" default:"25s"`
	MediaMemoryMiB   int           `env:"MEDIA_MEMORY_MIB" default:"256"`
	MediaIOPressure  float64       `env:"MEDIA_IO_PRESSURE" default:"30"`
	Notify           bool          `env:"TELEGRAM_ENABLED" default:"true"`
	NotifyToken      string        `env:"TELEGRAM_TOKEN"`
	NotifyChat       string        `env:"TELEGRAM_CHAT_ID"`
	SummaryHour      int           `env:"SUMMARY_HOUR" default:"20"`
	Timezone         string        `env:"TIMEZONE" default:"Asia/Shanghai"`
	MaxAttempts      int           `env:"MAX_ATTEMPTS" default:"12"`
}

func LoadConfig(filename string) (Config, error) {
	var c Config
	values := map[string]string{}
	if filename != "" {
		f, e := os.Open(filename)
		if e != nil {
			return c, e
		}
		defer f.Close()
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			s := strings.TrimSpace(scanner.Text())
			if s == "" || strings.HasPrefix(s, "#") {
				continue
			}
			k, v, ok := strings.Cut(s, "=")
			if !ok {
				return c, fmt.Errorf("invalid configuration line")
			}
			k = strings.TrimSpace(k)
			if _, exists := values[k]; exists {
				return c, fmt.Errorf("duplicate setting %s", k)
			}
			values[k] = strings.TrimSpace(v)
		}
		if e := scanner.Err(); e != nil {
			return c, e
		}
	}
	known := map[string]bool{}
	v := reflect.ValueOf(&c).Elem()
	t := v.Type()
	for i := 0; i < v.NumField(); i++ {
		f := t.Field(i)
		name := "ANIBT_" + f.Tag.Get("env")
		known[name] = true
		raw := f.Tag.Get("default")
		if x, ok := values[name]; ok {
			raw = x
		}
		if x, ok := os.LookupEnv(name); ok {
			raw = x
		}
		var e error
		if f.Type == reflect.TypeFor[time.Duration]() {
			var d time.Duration
			d, e = time.ParseDuration(raw)
			v.Field(i).SetInt(int64(d))
		} else {
			switch f.Type.Kind() {
			case reflect.String:
				v.Field(i).SetString(raw)
			case reflect.Bool:
				var b bool
				b, e = strconv.ParseBool(raw)
				v.Field(i).SetBool(b)
			case reflect.Int:
				var n int64
				n, e = strconv.ParseInt(raw, 10, 64)
				v.Field(i).SetInt(n)
			case reflect.Float64:
				var n float64
				n, e = strconv.ParseFloat(raw, 64)
				v.Field(i).SetFloat(n)
			}
		}
		if e != nil {
			return c, fmt.Errorf("invalid %s", name)
		}
	}
	for k := range values {
		if !known[k] {
			return c, fmt.Errorf("unknown setting %s", k)
		}
	}
	return c, c.Validate()
}
func (c Config) Validate() error {
	v := reflect.ValueOf(c)
	for i := 0; i < v.NumField(); i++ {
		if v.Field(i).Kind() == reflect.Float64 && (math.IsNaN(v.Field(i).Float()) || math.IsInf(v.Field(i).Float(), 0)) {
			return fmt.Errorf("non-finite setting")
		}
	}
	if c.Cleanup && c.Commands < 5 {
		return fmt.Errorf("cleanup requires at least five control commands")
	}

	for _, s := range []string{c.QBTURL, c.APIRoot} {
		u, e := url.Parse(s)
		if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") {
			return fmt.Errorf("invalid base URL")
		}
	}
	for _, p := range []string{c.QBTRoot, c.MediaRoot, c.StateDir} {
		if !filepath.IsAbs(p) || filepath.Clean(p) != p || p == "/" {
			return fmt.Errorf("roots must be clean absolute non-root paths")
		}
	}
	if c.QBTKey == "" || (c.Media && c.APIToken == "") || (c.Notify && (c.NotifyToken == "" || c.NotifyChat == "")) {
		return fmt.Errorf("missing qB, AniBT media, or Telegram credentials")
	}
	if _, e := time.LoadLocation(c.Timezone); e != nil {
		return fmt.Errorf("invalid timezone")
	}
	if c.ControlInterval < time.Second || c.ControlBudget < time.Second || c.ControlBudget > c.ControlInterval || c.QBTTimeout < time.Second || c.QBTTimeout > time.Minute {
		return fmt.Errorf("invalid control timing")
	}
	if c.FeedInterval < time.Second || c.FeedSync < time.Minute || c.FeedConcurrency < 1 || c.FeedConcurrency > 16 || c.FeedLimit < 1 || c.FeedLimit > 1000 || c.FeedMaxAge < 0 {
		return fmt.Errorf("invalid feed settings")
	}
	if c.Commands < 1 || c.Commands > 100 || c.PrepareBatch < 1 || c.PrepareBatch > 50 || c.AddBatch < 1 || c.AddBatch > 50 || c.ConfirmTimeout < time.Second || c.StallTimeout < time.Minute || c.MaxAttempts < 1 || c.MaxAttempts > 100 {
		return fmt.Errorf("invalid task bounds")
	}
	if c.PoolTarget < 1 || c.PoolBatch < 0 || c.PoolBatch > 1000 || c.RotationBatch < 0 || c.RotationBatch > 1000 || c.RotationInterval < time.Second || c.Exposure < 0 || c.Hot < 0 {
		return fmt.Errorf("invalid pool settings")
	}
	if c.CleanupInterval < time.Second || c.CleanupBatch < 0 || c.CleanupBatch > 100 || c.Protect < 0 || c.RetainDays < 0 || c.HistoryDays < 2 || c.MinFreeGiB < 0 || c.MaxDiskPercent <= 0 || c.MaxDiskPercent > 100 {
		return fmt.Errorf("invalid retention settings")
	}
	if c.MediaSamples < 1 || c.MediaSamples > 20 || c.MediaTimeout < time.Second || c.MediaTimeout > 2*time.Minute || c.MediaInterval < time.Second || c.MediaMemoryMiB < 64 || c.MediaMemoryMiB > 2048 || c.MediaIOPressure < 0 || c.MediaIOPressure > 100 {
		return fmt.Errorf("invalid media bounds")
	}
	if c.SummaryHour < 0 || c.SummaryHour > 23 || c.MaxTorrentGiB < 0 || c.UploadMiB < 0 || c.DownloadMiB < 0 || c.BusyUploadMiB < 0 || c.HourlyGiB < 0 || c.DailyGiB < 0 || c.Category == "" {
		return fmt.Errorf("invalid policy settings")
	}
	return nil
}
func splitSet(v string) map[string]bool {
	m := map[string]bool{}
	for _, s := range strings.Split(v, ",") {
		if s = strings.TrimSpace(s); s != "" {
			m[s] = true
		}
	}
	return m
}
func (c Config) excluded(slug string) bool {
	return splitSet(strings.ToLower(c.ExcludedGroups))[strings.ToLower(slug)]
}
