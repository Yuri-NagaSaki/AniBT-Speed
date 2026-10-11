"""The only qB caller in the worker. All policy decisions share one fresh snapshot."""

import asyncio
import logging
import shutil
import time
from collections import Counter

from app.cleanup import plan_cleanup, plan_rate
from app.config import Settings
from app.domain import Command, Snapshot, StoragePressure
from app.qbt import QBTClient, QBTError
from app.queue import plan_queue
from app.store import Store

log = logging.getLogger(__name__)


def storage_pressure(settings: Settings, snapshot: Snapshot) -> StoragePressure:
    free = snapshot.server.get("free_space_on_disk")
    # The volume is mounted at the same path as in qB. A percentage requires
    # actual filesystem capacity; torrent sizes are never used as capacity.
    try:
        usage = shutil.disk_usage(settings.download_root)
        return StoragePressure(min(usage.free, int(free)) if free is not None else usage.free, usage.total)
    except OSError:
        return StoragePressure(int(free) if free is not None else None)


class Controller:
    def __init__(self, settings: Settings, store: Store, qbt: QBTClient, *, media=None, notify=None):
        self.settings, self.store, self.qbt = settings, store, qbt
        self.media, self.notify = media, notify
        self.snapshot: Snapshot | None = None
        self.last_cleanup = 0.0
        self.class_cursor = 0
        self.commands_accepted = 0
        self.last_plan: list[dict] = []
        self._lock = asyncio.Lock()

    async def _execute(self, command: Command):
        record = {"kind": command.kind, "hashes": list(command.hashes), "reason": command.reason}
        self.last_plan.append(record)
        if self.settings.dry_run:
            return
        await asyncio.to_thread(self.store.event, "command_requested", record, time.time())
        await self.qbt.execute(command)
        await asyncio.to_thread(self.store.event, "command_accepted", record, time.time())
        self.commands_accepted += 1

    async def cycle(self):
        # Explicit guard also covers future/manual callers, independently of the runner.
        if self._lock.locked():
            return
        async with self._lock:
            async with asyncio.timeout(self.settings.control_budget_seconds):
                await self._cycle()

    async def _cycle(self):
        settings = self.settings
        snapshot = await self.qbt.snapshot()
        self.snapshot = snapshot
        now = snapshot.observed_at
        self.last_plan = []
        torrents = {torrent.hash: torrent for torrent in snapshot.torrents}
        managed = {key for key, torrent in torrents.items() if torrent.managed(settings)}
        exposures = await asyncio.to_thread(
            self.store.observe,
            snapshot,
            media_enabled=settings.mediainfo_enabled and not settings.dry_run,
            managed_hashes=managed,
        )
        confirmed = await asyncio.to_thread(
            self.store.reconcile_downloads, set(torrents), now, settings.confirmation_seconds
        )
        if self.notify and settings.notify_downloads:
            for job in confirmed:
                self.notify.offer(f"AniBT 下载已确认：{job['title']}")
        pressure = await asyncio.to_thread(storage_pressure, settings, snapshot)
        hourly, daily = await asyncio.to_thread(self.store.traffic_totals, now)
        protected_hash = self.media.active_hash if self.media else None
        deletions = (
            [
                command
                for command in plan_cleanup(snapshot.torrents, settings, pressure, now)
                if protected_hash not in command.hashes
            ]
            if now - self.last_cleanup >= settings.cleanup_interval_seconds
            else []
        )
        deleting = {key for command in deletions for key in command.hashes}
        if self.media:
            self.media.blocked_hashes = deleting
        last_rotation = await asyncio.to_thread(self.store.get_meta, "last_rotation", 0)
        rotate = now - last_rotation >= settings.rotation_interval_seconds
        queue = plan_queue(
            tuple(t for t in snapshot.torrents if t.hash not in deleting), settings, exposures, now, rotate=rotate
        )
        budget = settings.control_max_commands
        for command in plan_rate(snapshot.server, settings, hourly, daily) + queue:
            if budget == 0:
                break
            await self._execute(command)
            budget -= 1
        if rotate and any(command.kind == "pause" for command in queue) and not settings.dry_run:
            await asyncio.to_thread(self.store.set_meta, "last_rotation", now)
        jobs = await asyncio.to_thread(self.store.due_releases, "ready", now, settings.download_batch)
        if pressure.needs_cleanup(settings):
            jobs = []  # Backpressure intake while storage recovery is pending.
        manifests = (
            await asyncio.to_thread(self.store.media_due, ("manifest",), now)
            if settings.mediainfo_enabled and not settings.dry_run
            else []
        )
        has_category = settings.category in snapshot.categories
        phases = ["downloads", "cleanup", "manifest"]
        phases = phases[self.class_cursor :] + phases[: self.class_cursor]
        self.class_cursor = (self.class_cursor + 1) % len(phases)
        # Round-robin admissions prevent a download backlog from starving cleanup or media.
        while budget and (jobs or deletions or manifests):
            for phase in phases:
                if not budget:
                    break
                if phase == "downloads" and jobs:
                    job = jobs.pop(0)
                    if job["slug"] in settings.excluded_groups or (
                        job["published"]
                        and settings.rss_max_age_hours
                        and now - job["published"] > settings.rss_max_age_hours * 3600
                    ):
                        await asyncio.to_thread(
                            self.store.ignore_release, job["key"], "admission policy changed or release expired", now
                        )
                        continue
                    if not has_category:
                        await self._execute(Command("category", reason="download category"))
                        has_category = True
                        budget -= 1
                        if not budget:
                            break
                    if not settings.dry_run:
                        await asyncio.to_thread(self.store.submitting, job["key"], now)
                    await self._execute(
                        Command(
                            "add",
                            (job["infohash"],),
                            "RSS admission",
                            {
                                "save_path": job["save_path"],
                                "tags": job["tags"],
                                "content": job["content"],
                                "url": job["url"],
                            },
                        )
                    )
                    budget -= 1
                elif phase == "cleanup" and deletions:
                    command = deletions.pop(0)
                    # Media may have started while a prior HTTP operation was in flight.
                    if self.media and self.media.active_hash in command.hashes:
                        continue
                    await self._execute(command)
                    for key in command.hashes:
                        if self.media:
                            await asyncio.to_thread(self.store.media_stage, key, "skipped", now)
                        torrents.pop(key, None)
                        managed.discard(key)
                    self.last_cleanup = now
                    budget -= 1
                    if self.notify and settings.notify_cleanups:
                        self.notify.offer(f"AniBT 已提交清理：{command.hashes[0]}（{command.reason}）")
                elif phase == "manifest" and manifests:
                    job = manifests.pop(0)
                    torrent = torrents.get(job["hash"])
                    if not torrent or torrent.hash not in managed or torrent.progress < 1:
                        await asyncio.to_thread(self.store.media_stage, job["hash"], "skipped", now)
                        continue
                    try:
                        files = await self.qbt.files(job["hash"])
                    except QBTError as error:
                        await asyncio.to_thread(self.store.media_retry, job["hash"], str(error), time.time())
                        log.warning("Media manifest deferred hash=%s error=%s", job["hash"], error)
                        return
                    budget -= 1
                    await asyncio.to_thread(self.store.media_stage, job["hash"], "ready", now, files=files)
        log.info(
            "Control cycle torrents=%d qbt_commands=%d upload=%d download=%d",
            len(torrents),
            settings.control_max_commands - budget,
            snapshot.server.get("up_info_speed", 0),
            snapshot.server.get("dl_info_speed", 0),
        )

    def summary(self) -> dict:
        snapshot = self.snapshot
        return {
            "observed_at": snapshot.observed_at if snapshot else None,
            "torrents": len(snapshot.torrents) if snapshot else 0,
            "states": dict(Counter(t.state for t in snapshot.torrents)) if snapshot else {},
            "upload_bytes_per_second": snapshot.server.get("up_info_speed", 0) if snapshot else 0,
            "download_bytes_per_second": snapshot.server.get("dl_info_speed", 0) if snapshot else 0,
            "commands_accepted": self.commands_accepted,
            "http_requests": sum(self.qbt.requests.values()),
            "http_failures": self.qbt.failures,
            "response_bytes": self.qbt.bytes_received,
            "full_updates": self.qbt.full_updates,
            "delta_updates": self.qbt.delta_updates,
        }
