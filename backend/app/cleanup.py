"""Pure retention and rate plans; all destructive eligibility is explicit."""

from app.config import Settings
from app.domain import Command, StoragePressure, Torrent


def shared_content_hashes(torrents: tuple[Torrent, ...]) -> set[str]:
    """Protect equal or nested content roots, including roots owned by other categories."""
    unsafe: set[str] = set()
    ancestors: list[tuple[str, str]] = []
    for path, infohash in sorted((t.content_path.rstrip("/"), t.hash) for t in torrents if t.content_path):
        while ancestors and path != ancestors[-1][0] and not path.startswith(ancestors[-1][0] + "/"):
            ancestors.pop()
        if ancestors:
            unsafe.update((infohash, ancestors[-1][1]))
        ancestors.append((path, infohash))
    return unsafe


def plan_cleanup(
    torrents: tuple[Torrent, ...], settings: Settings, pressure: StoragePressure, now: float
) -> list[Command]:
    if not settings.cleanup_enabled or not settings.cleanup_batch:
        return []
    shared = shared_content_hashes(torrents)
    eligible = [
        t
        for t in torrents
        if t.content_path
        and t.hash not in shared
        and t.managed(settings)
        and t.completed
        and not t.has_demand(settings)
        and t.seed_age(now) >= settings.protect_hours * 3600
    ]
    if pressure.needs_cleanup(settings):
        # One deletion, then reobserve actual free space. Never infer disk use from torrent sizes.
        candidates = sorted(eligible, key=lambda t: (-t.ratio, t.completion_on, t.hash))
        if candidates:
            return [Command("delete", (candidates[0].hash,), "storage reserve")]
    if not settings.retain_days:
        return []
    expired = sorted(
        (t for t in eligible if t.seed_age(now) >= settings.retain_days * 86400),
        key=lambda t: (t.completion_on, t.hash),
    )
    return [Command("delete", (t.hash,), "retention expired") for t in expired[: settings.cleanup_batch]]


def plan_rate(server: dict, settings: Settings, hourly_bytes: int, daily_bytes: int) -> list[Command]:
    if not settings.rate_enabled:
        return []
    downloading = server.get("dl_info_speed", 0) > 10240
    upload = int((settings.downloading_upload_mib if downloading else settings.upload_mib) * 1024**2)
    download = int(settings.download_mib * 1024**2) if downloading else 0
    if (settings.hourly_upload_gib and hourly_bytes >= settings.hourly_upload_gib * 1024**3) or (
        settings.daily_upload_gib and daily_bytes >= settings.daily_upload_gib * 1024**3
    ):
        upload = download = 1024
    return [
        Command(kind, reason="traffic policy", values={"limit": value})
        for kind, field, value in (
            ("upload_limit", "up_rate_limit", upload),
            ("download_limit", "dl_rate_limit", download),
        )
        if server.get(field) != value
    ]
