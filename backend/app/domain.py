"""Torrent state and decisions shared by the controller and pure policies."""

import re
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any

from app.config import Settings

SEEDING = frozenset({"uploading", "stalledUP"})
STOPPED = frozenset({"stoppedUP", "pausedUP"})
TRANSITIONING = frozenset({"queuedUP", "checkingUP", "moving", "allocating"})


@dataclass(frozen=True)
class Torrent:
    hash: str
    name: str = ""
    state: str = "unknown"
    category: str = ""
    save_path: str = ""
    content_path: str = ""
    tags: frozenset[str] = frozenset()
    progress: float = 0
    added_on: float = 0
    completion_on: float = 0
    last_activity: float = 0
    num_leechs: int = 0
    upspeed: int = 0
    dlspeed: int = 0
    ratio: float = 0
    size: int = 0

    @classmethod
    def from_qbt(cls, torrent_hash: str, values: dict[str, Any]) -> "Torrent":
        if not re.fullmatch(r"[a-fA-F0-9]{40}|[a-fA-F0-9]{64}", torrent_hash):
            raise ValueError("Invalid torrent hash")
        return cls(
            hash=torrent_hash,
            name=str(values.get("name", "")),
            state=str(values.get("state", "unknown")),
            category=str(values.get("category", "")),
            save_path=str(values.get("save_path", "")),
            content_path=str(values.get("content_path", "")),
            tags=frozenset(x.strip() for x in str(values.get("tags", "")).split(",") if x.strip()),
            **{
                key: float(values.get(key) or 0)
                for key in ("progress", "added_on", "completion_on", "last_activity", "ratio")
            },
            **{key: int(values.get(key) or 0) for key in ("num_leechs", "upspeed", "dlspeed", "size")},
        )

    def managed(self, settings: Settings) -> bool:
        base = settings.download_root.rstrip("/")
        path = self.save_path.rstrip("/")
        return (
            self.category == settings.category
            and ".." not in PurePosixPath(path).parts
            and (path == base or path.startswith(base + "/"))
            and not self.tags.intersection(settings.protected_tags)
        )

    @property
    def completed(self) -> bool:
        return self.progress >= 1 and self.state in SEEDING | STOPPED

    def seed_age(self, now: float) -> float:
        return now - self.completion_on if self.completed and self.completion_on > 0 else -1

    def has_demand(self, settings: Settings) -> bool:
        return self.num_leechs > 0 or self.upspeed > 0


@dataclass(frozen=True)
class Snapshot:
    torrents: tuple[Torrent, ...]
    server: dict[str, Any]
    observed_at: float
    categories: frozenset[str] = frozenset()


@dataclass(frozen=True)
class Command:
    kind: str
    hashes: tuple[str, ...] = ()
    reason: str = ""
    values: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Exposure:
    started_at: float = 0
    last_started_at: float = 0


@dataclass(frozen=True)
class StoragePressure:
    free: int | None
    total: int | None = None

    def needs_cleanup(self, settings: Settings) -> bool:
        if self.free is None:
            return False
        reserve = settings.min_free_gib * 1024**3
        if self.total:
            reserve = max(reserve, self.total * (1 - settings.disk_max_used_percent / 100))
        return self.free < reserve
