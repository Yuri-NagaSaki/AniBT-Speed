"""Bounded HTTP operations and incremental state owned by one controller."""

import asyncio
import json
import time
from collections import Counter
from typing import Any

import httpx

from app.config import Settings
from app.domain import Command, Snapshot, Torrent


class QBTError(RuntimeError):
    """A failed or ambiguous operation. Refresh state before further writes."""


class QBTClient:
    def __init__(
        self, settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None, read_only: bool = False
    ):
        self.settings = settings
        self.read_only = read_only
        self.http = httpx.AsyncClient(
            base_url=settings.qbt_url.rstrip("/") + "/api/v2/",
            headers={"Authorization": f"Bearer {settings.qbt_api_key.get_secret_value()}"},
            timeout=httpx.Timeout(settings.qbt_timeout_seconds, connect=settings.qbt_connect_timeout_seconds),
            limits=httpx.Limits(max_connections=1, max_keepalive_connections=1),
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        )
        self._lock = asyncio.Lock()
        self._rid = 0
        self._torrents: dict[str, dict[str, Any]] = {}
        self._server: dict[str, Any] = {}
        self._categories: set[str] = set()
        self.requests: Counter[str] = Counter()
        self.failures = 0
        self.bytes_received = 0
        self.full_updates = 0
        self.delta_updates = 0

    async def close(self):
        await self.http.aclose()

    async def request(self, method: str, path: str, **kwargs) -> bytes:
        if method != "GET" and self.read_only:
            raise QBTError("qB mutations are disabled in read-only mode")
        async with self._lock:
            self.requests[f"{method} {path}"] += 1
            try:
                async with asyncio.timeout(self.settings.qbt_timeout_seconds):
                    async with self.http.stream(method, path, **kwargs) as response:
                        if not 200 <= response.status_code < 300:
                            raise QBTError(f"qB {method} {path}: HTTP {response.status_code}")
                        body = bytearray()
                        async for chunk in response.aiter_bytes():
                            body.extend(chunk)
                            if len(body) > self.settings.qbt_max_response_mb * 1024**2:
                                raise QBTError(f"qB {path}: response exceeds configured limit")
                        self.bytes_received += len(body)
                        return bytes(body)
            except (httpx.HTTPError, TimeoutError) as error:
                self.failures += 1
                raise QBTError(f"qB {method} {path}: {type(error).__name__}") from None
            except QBTError:
                self.failures += 1
                raise

    async def snapshot(self) -> Snapshot:
        raw = await self.request("GET", "sync/maindata", params={"rid": self._rid})
        try:
            data = json.loads(raw)
            rid = data["rid"]
            if not isinstance(rid, int) or isinstance(rid, bool) or rid < 0:
                raise ValueError("invalid rid")
            full = data.get("full_update", False)
            if not self._rid and not full:
                raise ValueError("initial sync must contain a full update")
            torrents = {} if full else self._torrents.copy()
            server = {} if full else self._server.copy()
            categories = set() if full else self._categories.copy()
            for key, value in data.get("torrents", {}).items():
                torrents[key] = {**torrents.get(key, {}), **value}
            for key in data.get("torrents_removed", []):
                torrents.pop(key, None)
            server.update(data.get("server_state", {}))
            categories.update(data.get("categories", {}))
            categories.difference_update(data.get("categories_removed", []))
            snapshot = Snapshot(
                tuple(Torrent.from_qbt(k, v) for k, v in torrents.items()), server, time.time(), frozenset(categories)
            )
        except ValueError, TypeError, KeyError, AttributeError:
            self._rid = 0
            raise QBTError("qB sync/maindata: invalid or incomplete snapshot") from None
        self._rid, self._torrents, self._server, self._categories = rid, torrents, server, categories
        if full:
            self.full_updates += 1
        else:
            self.delta_updates += 1
        return snapshot

    async def execute(self, command: Command):
        hashes = "|".join(command.hashes)
        match command.kind:
            case "pause" | "resume":
                if hashes:
                    endpoint = "stop" if command.kind == "pause" else "start"
                    await self.request("POST", f"torrents/{endpoint}", data={"hashes": hashes})
            case "delete":
                if hashes:
                    await self.request("POST", "torrents/delete", data={"hashes": hashes, "deleteFiles": "true"})
            case "tag":
                if hashes:
                    await self.request(
                        "POST", "torrents/addTags", data={"hashes": hashes, "tags": command.values["tags"]}
                    )
            case "category":
                await self.request(
                    "POST",
                    "torrents/createCategory",
                    data={"category": self.settings.category, "savePath": self.settings.download_root},
                )
            case "upload_limit" | "download_limit":
                endpoint = "setUploadLimit" if command.kind == "upload_limit" else "setDownloadLimit"
                await self.request("POST", f"transfer/{endpoint}", data={"limit": str(command.values["limit"])})
            case "add":
                fields = {
                    "savepath": command.values["save_path"],
                    "category": self.settings.category,
                    "tags": command.values["tags"],
                    "autoTMM": "false",
                }
                if command.values.get("content"):
                    kwargs = {
                        "data": fields,
                        "files": {
                            "torrents": ("release.torrent", command.values["content"], "application/x-bittorrent")
                        },
                    }
                else:
                    kwargs = {"data": {**fields, "urls": command.values["url"]}}
                body = await self.request("POST", "torrents/add", **kwargs)
                if body.strip() != b"Ok.":
                    raise QBTError("qB torrents/add: torrent was not accepted")
            case _:
                raise ValueError(f"Unknown command: {command.kind}")

    async def files(self, infohash: str) -> list[dict]:
        try:
            result = json.loads(await self.request("GET", "torrents/files", params={"hash": infohash}))
            if not isinstance(result, list) or len(result) > 50000:
                raise ValueError("Invalid file manifest")
            return [
                {"name": str(file["name"]), "size": int(file["size"]), "progress": float(file.get("progress", 1))}
                for file in result
            ]
        except ValueError, KeyError, TypeError:
            raise QBTError("qB torrents/files: invalid file manifest") from None
