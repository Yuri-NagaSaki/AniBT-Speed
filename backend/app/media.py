"""Low-priority, bounded media extraction and durable AniBT delivery."""

import asyncio
import json
import logging
import os
import signal
import time
from pathlib import Path, PurePosixPath

import httpx

from app.config import Settings
from app.media_format import parse_tracks, payload_for_files, select_samples
from app.store import Store

log = logging.getLogger(__name__)


def safe_media_path(root: str, save_path: str, relative: str) -> Path:
    filename = PurePosixPath(relative)
    if filename.is_absolute() or ".." in filename.parts or "\x00" in relative:
        raise ValueError("Unsafe media file path")
    base = Path(root).resolve()
    path = (Path(save_path) / relative).resolve()
    if not path.is_relative_to(base) or not path.is_file():
        raise ValueError("Media file missing or outside DOWNLOAD_ROOT")
    return path


def io_pressure() -> float:
    try:
        for line in Path("/proc/pressure/io").read_text().splitlines():
            if line.startswith("full "):
                return float(dict(item.split("=") for item in line.split()[1:])["avg10"])
    except OSError, ValueError, KeyError:
        pass
    return 0.0


async def extract(path: Path, settings: Settings) -> dict:
    process = await asyncio.create_subprocess_exec(
        "nice",
        "-n",
        "19",
        "ionice",
        "-c",
        "3",
        "prlimit",
        f"--as={settings.mediainfo_memory_mb * 1024**2}",
        "--",
        "mediainfo",
        "--Output=JSON",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        start_new_session=True,
    )
    try:
        async with asyncio.timeout(settings.mediainfo_timeout_seconds):
            result = bytearray()
            while chunk := await process.stdout.read(65536):
                result.extend(chunk)
                if len(result) > settings.mediainfo_max_output_bytes:
                    raise ValueError("MediaInfo exceeds output limit")
            if await process.wait() != 0:
                raise ValueError("MediaInfo process failed")
            return parse_tracks(json.loads(result))
    finally:
        if process.returncode is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await process.wait()


class MediaPipeline:
    def __init__(self, settings: Settings, store: Store, *, transport=None, extractor=extract):
        self.settings, self.store, self.extractor = settings, store, extractor
        self.http = httpx.AsyncClient(
            timeout=15,
            follow_redirects=False,
            transport=transport,
            headers={"Authorization": f"Bearer {settings.anibt_api_token.get_secret_value()}"},
        )
        self.active_hash: str | None = None
        self.blocked_hashes: set[str] = set()
        self.deferred_for_io = False
        self.extractions = 0
        self.deliveries = 0

    async def close(self):
        await self.http.aclose()

    async def step(self):
        jobs = await asyncio.to_thread(self.store.media_due, ("upload", "ready"), time.time())
        if not jobs:
            return
        job = jobs[0]
        if job["hash"] in self.blocked_hashes:
            return
        # Already extracted payloads can be sent even while disk pressure is high.
        self.deferred_for_io = (
            job["status"] == "ready"
            and self.settings.mediainfo_io_pressure_limit > 0
            and await asyncio.to_thread(io_pressure) >= self.settings.mediainfo_io_pressure_limit
        )
        if self.deferred_for_io:
            return
        self.active_hash = job["hash"]
        try:
            if job["status"] == "ready":
                files = json.loads(job["files"])
                samples = select_samples(files, self.settings.mediainfo_sample_files)
                if not samples:
                    await asyncio.to_thread(self.store.media_stage, job["hash"], "skipped", time.time())
                    return
                parsed = {}
                for file in samples:
                    path = await asyncio.to_thread(
                        safe_media_path, self.settings.download_root, job["save_path"], file["name"]
                    )
                    parsed[file["name"]] = await self.extractor(path, self.settings)
                    self.extractions += 1
                payload = payload_for_files(
                    job["hash"], job["name"], files, parsed, self.settings.mediainfo_max_payload_bytes
                )
                await asyncio.to_thread(self.store.media_stage, job["hash"], "upload", time.time(), payload=payload)
            else:
                payload = json.loads(job["payload"])
            encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
            if len(encoded) > self.settings.mediainfo_max_payload_bytes:
                raise ValueError("MediaInfo exceeds payload limit")
            async with asyncio.timeout(15):
                response = await self.http.put(
                    self.settings.anibt_api_url.rstrip("/") + "/api/releases/mediainfo",
                    content=encoded,
                    headers={"Content-Type": "application/json"},
                )
            if response.status_code != 200:
                delay = 3600 if response.status_code in {401, 403, 404, 422} else 60
                await asyncio.to_thread(
                    self.store.media_retry, job["hash"], f"AniBT HTTP {response.status_code}", time.time(), delay
                )
                if response.status_code in {404, 422}:
                    return  # Item-specific deferral, visible in the persistent queue.
                raise RuntimeError(f"MediaInfo delivery HTTP {response.status_code}")
            if response.json().get("ok") is not True:
                raise ValueError("AniBT did not acknowledge MediaInfo")
            await asyncio.to_thread(self.store.media_stage, job["hash"], "done", time.time())
            self.deliveries += 1
            log.info("MediaInfo delivered hash=%s", job["hash"])
        except (OSError, ValueError, TypeError, KeyError, httpx.HTTPError, TimeoutError) as error:
            message = f"MediaInfo {type(error).__name__}"
            await asyncio.to_thread(self.store.media_retry, job["hash"], message, time.time())
            raise RuntimeError(message) from None
        finally:
            self.active_hash = None
