"""The v1 configuration contract; no legacy aliases or import-time side effects."""

from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="worker.env", extra="forbid")
    qbt_url: str = ""
    qbt_api_key: SecretStr = SecretStr("")
    download_root: str = "/media/AniBT"
    category: str = "AniBT"
    managed_tag: str = "AniBT"
    excluded_tags: str = "keep"
    state_dir: Path = Path("./data")
    anibt_api_url: str = "https://anibt.net"
    anibt_excluded_group_slugs: str = "kirara-fantasia,ani,zzz123,pre-s,silent-workshop"
    qbt_timeout_seconds: float = Field(default=8, gt=0, le=60)
    qbt_connect_timeout_seconds: float = Field(default=3, gt=0, le=30)
    qbt_max_response_mb: int = Field(default=64, ge=1, le=256)
    control_interval_seconds: float = Field(default=30, ge=1)
    control_budget_seconds: float = Field(default=20, gt=0)
    control_max_commands: int = Field(default=8, ge=1, le=100)
    control_backoff_max_seconds: float = Field(default=300, ge=1)
    status_stale_seconds: float = Field(default=180, ge=1)
    dry_run: bool = False

    rss_enabled: bool = True
    rss_poll_seconds: float = Field(default=300, ge=1)
    rss_sync_seconds: float = Field(default=43200, ge=1)
    rss_budget_seconds: float = Field(default=240, gt=0)
    rss_timeout_seconds: float = Field(default=15, gt=0, le=60)
    rss_concurrency: int = Field(default=3, ge=1, le=16)
    rss_max_response_mb: int = Field(default=8, ge=1, le=64)
    rss_max_age_hours: float = Field(default=48, ge=0)
    bootstrap_history: bool = True
    rss_feed_limit: int = Field(default=100, ge=1, le=1000)
    download_batch: int = Field(default=3, ge=1, le=50)
    prepare_batch: int = Field(default=4, ge=1, le=50)
    confirmation_seconds: float = Field(default=120, ge=1)
    max_torrent_gib: float = Field(default=0, ge=0)

    pool_enabled: bool = True
    pool_target: int = Field(default=300, ge=1)
    pool_batch: int = Field(default=40, ge=0)
    rotation_batch: int = Field(default=10, ge=0)
    rotation_interval_seconds: float = Field(default=180, ge=1)
    exposure_seconds: float = Field(default=600, ge=0)
    hot_hours: float = Field(default=12, ge=0)
    cleanup_enabled: bool = True
    cleanup_interval_seconds: float = Field(default=300, ge=1)
    cleanup_batch: int = Field(default=5, ge=0, le=100)
    protect_hours: float = Field(default=8, ge=0)
    retain_days: float = Field(default=90, ge=0)
    min_free_gib: float = Field(default=100, ge=0)
    disk_max_used_percent: float = Field(default=85, gt=0, le=100)

    rate_enabled: bool = False
    upload_mib: float = Field(default=100, ge=0)
    downloading_upload_mib: float = Field(default=80, ge=0)
    download_mib: float = Field(default=60, ge=0)
    hourly_upload_gib: float = Field(default=0, ge=0)
    daily_upload_gib: float = Field(default=0, ge=0)
    history_days: int = Field(default=90, ge=2)

    mediainfo_enabled: bool = False
    anibt_api_token: SecretStr = SecretStr("")
    mediainfo_interval_seconds: float = Field(default=30, ge=1)
    mediainfo_sample_files: int = Field(default=6, ge=1, le=20)
    mediainfo_timeout_seconds: float = Field(default=25, gt=0, le=120)
    mediainfo_memory_mb: int = Field(default=256, ge=64, le=2048)
    mediainfo_budget_seconds: float = Field(default=180, gt=0, le=600)
    mediainfo_max_output_bytes: int = Field(default=1048576, ge=1024)
    mediainfo_max_payload_bytes: int = Field(default=200000, ge=4096, le=1000000)
    mediainfo_io_pressure_limit: float = Field(default=30, ge=0, le=100)

    notifications_enabled: bool = False
    notify_token: SecretStr = SecretStr("")
    notify_chat_id: str = ""
    notify_downloads: bool = True
    notify_cleanups: bool = True
    daily_summary_hour: int = Field(default=20, ge=0, le=23)
    timezone: str = "Asia/Shanghai"

    @model_validator(mode="after")
    def bounds(self):
        if self.control_budget_seconds > self.control_interval_seconds:
            raise ValueError("CONTROL_BUDGET_SECONDS must not exceed CONTROL_INTERVAL_SECONDS")
        if self.status_stale_seconds <= self.control_interval_seconds:
            raise ValueError("STATUS_STALE_SECONDS must exceed CONTROL_INTERVAL_SECONDS")
        if (
            not self.download_root.startswith("/")
            or ".." in Path(self.download_root).parts
            or self.download_root == "/"
        ):
            raise ValueError("DOWNLOAD_ROOT must be an absolute, non-root directory without '..'")
        ZoneInfo(self.timezone)
        return self

    @property
    def database_path(self) -> Path:
        return self.state_dir / "state.sqlite3"

    @property
    def status_path(self) -> Path:
        return self.state_dir / "status.json"

    @property
    def excluded_groups(self) -> frozenset[str]:
        return frozenset(x.strip().casefold() for x in self.anibt_excluded_group_slugs.split(",") if x.strip())

    @property
    def protected_tags(self) -> frozenset[str]:
        return frozenset(x.strip() for x in self.excluded_tags.split(",") if x.strip())

    def require_runtime(self):
        for name, value in (("QBT_URL", self.qbt_url), ("ANIBT_API_URL", self.anibt_api_url)):
            url = urlsplit(value)
            if (
                url.scheme not in {"http", "https"}
                or not url.hostname
                or url.username
                or url.password
                or url.query
                or url.fragment
            ):
                raise ValueError(f"{name} must be an HTTP(S) base URL without credentials or query")
        if not self.qbt_api_key.get_secret_value().strip():
            raise ValueError("QBT_API_KEY is required")
        if self.mediainfo_enabled and not self.anibt_api_token.get_secret_value():
            raise ValueError("ANIBT_API_TOKEN is required when MEDIAINFO_ENABLED=true")
        if self.notifications_enabled and (not self.notify_token.get_secret_value() or not self.notify_chat_id):
            raise ValueError("Notifications require NOTIFY_TOKEN and NOTIFY_CHAT_ID")
