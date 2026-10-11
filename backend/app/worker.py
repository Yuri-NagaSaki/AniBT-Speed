"""The application lifecycle and four independent, bounded work lanes."""

import asyncio
import logging
import os
import signal
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from app import __version__
from app.config import Settings
from app.controller import Controller
from app.feeds import FeedPipeline
from app.lifecycle import WorkerLease, write_status
from app.media import MediaPipeline
from app.notify import Notifier
from app.qbt import QBTClient
from app.scheduling import PeriodicJob
from app.store import Store

log = logging.getLogger(__name__)


class Worker:
    def __init__(self, settings: Settings):
        settings.require_runtime()
        self.settings = settings
        self.store = Store(settings.database_path)
        self.qbt = QBTClient(settings, read_only=settings.dry_run)
        self.feeds = FeedPipeline(settings, self.store)
        self.media = (
            MediaPipeline(settings, self.store) if settings.mediainfo_enabled and not settings.dry_run else None
        )
        self.notifier = Notifier(settings) if settings.notifications_enabled and not settings.dry_run else None
        self.controller = Controller(settings, self.store, self.qbt, media=self.media, notify=self.notifier)
        self.jobs = {
            "control": PeriodicJob(
                "control",
                self.controller.cycle,
                settings.control_interval_seconds,
                settings.control_budget_seconds,
                settings.control_backoff_max_seconds,
            )
        }
        if settings.rss_enabled:
            self.jobs["feeds"] = PeriodicJob(
                "feeds", self.feeds.poll, settings.rss_poll_seconds, settings.rss_budget_seconds
            )
            self.jobs["prepare"] = PeriodicJob("prepare", self.feeds.prepare, 5, 120)
        if self.media:
            self.jobs["media"] = PeriodicJob(
                "media", self.media.step, settings.mediainfo_interval_seconds, settings.mediainfo_budget_seconds, 3600
            )
        if self.notifier:
            self.jobs["notifications"] = PeriodicJob("notifications", self.notifier.step, 2, 6)
        self.jobs["maintenance"] = PeriodicJob("maintenance", self.maintain, 3600, 30)
        self.tasks: list[asyncio.Task] = []
        self.started = time.time()

    async def maintain(self):
        await asyncio.to_thread(self.store.maintain, time.time(), self.settings.history_days)
        if self.notifier:
            now = datetime.now(ZoneInfo(self.settings.timezone))
            day = now.date().isoformat()
            sent = await asyncio.to_thread(self.store.get_meta, "summary_day")
            if now.hour >= self.settings.daily_summary_hour and day != sent:
                hourly, daily = await asyncio.to_thread(self.store.traffic_totals, time.time())
                self.notifier.offer(
                    f"AniBT 最近 24 小时上传：{daily / 1024**3:.2f} GiB；种子：{self.controller.summary()['torrents']}"
                )
                await asyncio.to_thread(self.store.set_meta, "summary_day", day)

    async def status(self) -> dict:
        control = self.jobs["control"].state
        now = time.time()
        state = "starting" if control.last_success is None else "ok"
        if control.error or (control.last_success and now - control.last_success > self.settings.status_stale_seconds):
            state = "degraded"
        if any(job.state.error for job in self.jobs.values()):
            state = "degraded"
        return {
            "version": __version__,
            "revision": os.environ.get("BUILD_REVISION", "development"),
            "pid": os.getpid(),
            "started_at": self.started,
            "updated_at": now,
            "status": state,
            "dry_run": self.settings.dry_run,
            "jobs": {name: job.status() for name, job in self.jobs.items()},
            "qbt": self.controller.summary(),
            "work": await asyncio.to_thread(self.store.stats),
            "mediainfo": {
                "enabled": self.media is not None,
                "active": self.media.active_hash if self.media else None,
                "deferred_for_io": self.media.deferred_for_io if self.media else False,
                "extractions": self.media.extractions if self.media else 0,
                "deliveries": self.media.deliveries if self.media else 0,
            },
        }

    async def report(self):
        while True:
            await asyncio.to_thread(write_status, self.settings.status_path, await self.status())
            await asyncio.sleep(5)

    async def run(self):
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for signum in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(signum, stop.set)
        with WorkerLease(self.settings.state_dir):
            await asyncio.to_thread(self.store.initialize)
            self.tasks = [asyncio.create_task(job.run(), name=name) for name, job in self.jobs.items()]
            self.tasks.append(asyncio.create_task(self.report(), name="status"))
            for task in self.tasks:
                task.add_done_callback(lambda _: stop.set())
            log.info(
                "AniBT worker started version=%s tasks=%s dry_run=%s",
                __version__,
                ",".join(self.jobs),
                self.settings.dry_run,
            )
            try:
                await stop.wait()
            finally:
                failures = [
                    task.exception()
                    for task in self.tasks
                    if task.done() and not task.cancelled() and task.exception() is not None
                ]
                for task in self.tasks:
                    task.cancel()
                await asyncio.gather(*self.tasks, return_exceptions=True)
                await self.qbt.close()
                await self.feeds.close()
                if self.media:
                    await self.media.close()
                if self.notifier:
                    await self.notifier.close()
                status = await self.status()
                status["status"] = "stopped"
                await asyncio.to_thread(write_status, self.settings.status_path, status)
                await asyncio.to_thread(self.store.close)
                log.info("AniBT worker stopped")
                if failures:
                    raise RuntimeError(f"Worker task exited: {type(failures[0]).__name__}") from None
