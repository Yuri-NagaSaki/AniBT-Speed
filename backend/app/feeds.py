"""RSS discovery and artifact preparation, independent of the qB controller."""

import asyncio
import calendar
import json
import logging
import re
import time
from urllib.parse import quote, urlsplit

import feedparser
import httpx

from app.config import Settings
from app.layout import download_layout
from app.store import Store
from app.torrent import magnet_hash, torrent_identity

log = logging.getLogger(__name__)


class SourceError(RuntimeError):
    pass


def canonical_key(value: str) -> str:
    value = value.strip()
    path = urlsplit(value).path if "://" in value else value
    return path.rstrip("/").rsplit("/", 1)[-1] if "/release/" in path else value


def text(entry: dict, key: str) -> str:
    value = entry.get(key, "")
    return str(value.get("value", "") if isinstance(value, dict) else value or "").strip()


def rss_entry(entry: dict, feed: dict, settings: Settings, now: float) -> dict | None:
    metadata = {
        "group_slug": text(entry, "anibt_groupslug") or feed["slug"],
        "group_name": text(entry, "anibt_groupname") or feed["name"],
        "anime_title": text(entry, "anibt_animetitle"),
        "anime_title_english": text(entry, "anibt_animetitleenglish"),
        "release_title": text(entry, "anibt_releasetitle") or text(entry, "title"),
        "bgm_id": text(entry, "anibt_bgmid"),
    }
    candidates = [text(entry, "anibt_torrenturl")]
    candidates += [link.get("href", "") for link in entry.get("enclosures", [])]
    candidates += [text(entry, "link")]
    url = next(
        (
            value
            for value in candidates
            if value and (value.startswith("magnet:") or urlsplit(value).path.endswith(".torrent"))
        ),
        "",
    )
    key = canonical_key(text(entry, "anibt_releaseid") or text(entry, "id") or text(entry, "guid") or url)
    if not key or not url:
        return None  # Do not terminally acknowledge malformed entries; allow source repair.
    stamp = entry.get("published_parsed") or entry.get("updated_parsed")
    published = float(calendar.timegm(stamp)) if stamp else None
    if settings.rss_max_age_hours and published is None:
        return None
    reason = ""
    if metadata["group_slug"] != feed["slug"]:
        reason = "group identity mismatch"
    elif metadata["group_slug"].casefold() in settings.excluded_groups:
        reason = "excluded group"
    elif published and settings.rss_max_age_hours and now - published > settings.rss_max_age_hours * 3600:
        reason = "release too old"
    elif published and published > now + 300:
        return None
    return {
        "key": key,
        "title": metadata["release_title"],
        "url": url,
        "metadata": metadata,
        "published": published,
        "ignore": reason,
    }


class FeedPipeline:
    def __init__(self, settings: Settings, store: Store, *, transport=None):
        self.settings, self.store = settings, store
        self.http = httpx.AsyncClient(
            timeout=settings.rss_timeout_seconds,
            follow_redirects=True,
            limits=httpx.Limits(max_connections=settings.rss_concurrency + 1),
            transport=transport,
            headers={"User-Agent": "AniBT-Speed/1.0"},
        )
        self.seasons: dict[str, tuple[float, str]] = {}
        self.last_sync = 0.0

    async def close(self):
        await self.http.aclose()

    async def fetch(self, url: str, **kwargs) -> bytes:
        try:
            async with asyncio.timeout(self.settings.rss_timeout_seconds):
                async with self.http.stream("GET", url, **kwargs) as response:
                    if response.status_code != 200:
                        raise SourceError(f"AniBT source HTTP {response.status_code}")
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > self.settings.rss_max_response_mb * 1024**2:
                            raise SourceError("AniBT source exceeds response limit")
                    return bytes(body)
        except (httpx.HTTPError, TimeoutError) as error:
            raise SourceError(f"AniBT source {type(error).__name__}") from None

    async def synchronize(self):
        payload = json.loads(await self.fetch(self.settings.anibt_api_url.rstrip("/") + "/api/subtitle-groups"))
        items = payload.get("data")
        if not isinstance(items, list) or not items:
            raise SourceError("Invalid or empty subtitle-group response")
        groups = {}
        for item in items:
            slug, name = item.get("slug"), item.get("name")
            if not isinstance(slug, str) or not re.fullmatch(r"[a-zA-Z0-9_-]+", slug) or not isinstance(name, str):
                raise SourceError("Invalid subtitle-group identity")
            groups[slug] = name
        await asyncio.to_thread(self.store.synchronize_feeds, groups, self.settings.excluded_groups)
        self.last_sync = time.monotonic()

    async def poll(self):
        errors = []
        if not self.last_sync or time.monotonic() - self.last_sync >= self.settings.rss_sync_seconds:
            try:
                await self.synchronize()
            except (SourceError, ValueError, TypeError, KeyError) as error:
                errors.append(str(error))
        feeds = await asyncio.to_thread(self.store.feeds)
        if not feeds:
            raise SourceError("No enabled feeds; discovery has not succeeded")
        semaphore = asyncio.Semaphore(self.settings.rss_concurrency)

        async def poll_one(feed):
            if feed["slug"] in self.settings.excluded_groups:
                return
            async with semaphore:
                now = time.time()
                try:
                    url = (
                        self.settings.anibt_api_url.rstrip("/") + "/rss/group/" + quote(feed["slug"], safe="") + ".xml"
                    )
                    data = await self.fetch(url, params={"limit": self.settings.rss_feed_limit})
                    parsed = await asyncio.to_thread(feedparser.parse, data)
                    if not parsed.version or (parsed.bozo and not parsed.entries):
                        raise SourceError("Invalid RSS response")
                    entries = [
                        value
                        for entry in parsed.entries
                        if (value := rss_entry(entry, feed, self.settings, now)) is not None
                    ]
                    history = self.settings.bootstrap_history and not feed["initialized"]
                    await asyncio.to_thread(self.store.ingest, feed["slug"], entries, now, history=history)
                except (SourceError, ValueError, TypeError, KeyError) as error:
                    message = f"{feed['slug']}: {error}"
                    errors.append(message)
                    await asyncio.to_thread(self.store.feed_error, feed["slug"], str(error), now)

        await asyncio.gather(*(poll_one(feed) for feed in feeds))
        if errors:
            raise SourceError(f"{len(errors)} RSS failures; {errors[0]}")

    async def season(self, bgm_id: str) -> str:
        if not bgm_id or not bgm_id.isdigit():
            return ""
        now = time.monotonic()
        if bgm_id in self.seasons and self.seasons[bgm_id][0] > now:
            return self.seasons[bgm_id][1]
        payload = json.loads(
            await self.fetch(self.settings.anibt_api_url.rstrip("/") + "/api/seasons/anime", params={"bgmId": bgm_id})
        )
        data = payload.get("data")
        label = str(data.get("requestedSeason") or "") if isinstance(data, dict) else ""
        self.seasons[bgm_id] = (now + (3600 if label else 300), label)
        # Bound a long-running worker's cache independently of catalog size.
        if len(self.seasons) > 4096:
            self.seasons = {key: value for key, value in self.seasons.items() if value[0] > now}
        return label

    async def prepare(self):
        jobs = await asyncio.to_thread(self.store.due_releases, "pending", time.time(), self.settings.prepare_batch)
        for job in jobs:
            now = time.time()
            try:
                if job["slug"] in self.settings.excluded_groups:
                    await asyncio.to_thread(self.store.ignore_release, job["key"], "excluded group", now)
                    continue
                if (
                    self.settings.rss_max_age_hours
                    and job["published"]
                    and now - job["published"] > self.settings.rss_max_age_hours * 3600
                ):
                    await asyncio.to_thread(self.store.ignore_release, job["key"], "release too old", now)
                    continue
                metadata = json.loads(job["metadata"])
                label = await self.season(metadata["bgm_id"]) if metadata["group_slug"] != "ktnbytes" else ""
                path, tags = download_layout(metadata, label, self.settings)
                content = None
                if job["url"].startswith("magnet:"):
                    infohash, size = magnet_hash(job["url"]), 0
                    if self.settings.max_torrent_gib:
                        raise SourceError("Cannot verify magnet size under MAX_TORRENT_GIB")
                else:
                    content = await self.fetch(job["url"])
                    infohash, size = await asyncio.to_thread(torrent_identity, content)
                if self.settings.max_torrent_gib and size > self.settings.max_torrent_gib * 1024**3:
                    await asyncio.to_thread(self.store.ignore_release, job["key"], "torrent exceeds size limit", now)
                    continue
                path = path.rstrip("/") + "/" + infohash
                await asyncio.to_thread(self.store.release_ready, job["key"], infohash, content, path, tags, now)
            except (SourceError, ValueError, KeyError, TypeError) as error:
                await asyncio.to_thread(self.store.retry_release, job["key"], str(error), now)
                log.warning("Download preparation deferred key=%s error=%s", job["key"], error)
