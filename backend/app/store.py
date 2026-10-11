"""Durable work state. Transactions contain local SQL only, never network work."""

import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

from app.domain import SEEDING, Exposure, Snapshot

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS feeds (
 slug TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL,
 initialized INTEGER NOT NULL DEFAULT 0, last_poll REAL NOT NULL DEFAULT 0,
 last_success REAL NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS seen_keys (key TEXT PRIMARY KEY, outcome TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS releases (
 key TEXT PRIMARY KEY, slug TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
 metadata TEXT NOT NULL, published REAL, status TEXT NOT NULL,
 infohash TEXT NOT NULL DEFAULT '', content BLOB, save_path TEXT NOT NULL DEFAULT '',
 tags TEXT NOT NULL DEFAULT '', created_at REAL NOT NULL, updated_at REAL NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt REAL NOT NULL DEFAULT 0,
 submitted_at REAL NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS releases_due ON releases(status,next_attempt,created_at);
CREATE INDEX IF NOT EXISTS releases_hash ON releases(infohash);
CREATE TABLE IF NOT EXISTS exposures (
 hash TEXT PRIMARY KEY, started_at REAL NOT NULL, last_started_at REAL NOT NULL, seen_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS traffic (
 ts REAL NOT NULL, uploaded INTEGER NOT NULL, downloaded INTEGER NOT NULL, seconds REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS traffic_time ON traffic(ts);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY, ts REAL NOT NULL, kind TEXT NOT NULL, details TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_time ON events(ts);
CREATE TABLE IF NOT EXISTS media (
 hash TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', save_path TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'manifest', files TEXT, payload TEXT,
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt REAL NOT NULL DEFAULT 0,
 error TEXT NOT NULL DEFAULT '', updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS media_due ON media(status,next_attempt,updated_at);
"""


class Store:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.RLock()
        self._db: sqlite3.Connection | None = None

    @contextmanager
    def connection(self):
        # One owner serializes local transactions across async callers' threads.
        # A persistent connection also avoids checkpointing WAL on every last-close.
        with self._lock:
            if self._db is None:
                self._db = sqlite3.connect(self.path, timeout=2, check_same_thread=False)
                self._db.row_factory = sqlite3.Row
            with self._db:
                yield self._db

    def close(self):
        with self._lock:
            if self._db is not None:
                self._db.close()
                self._db = None

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(SCHEMA)
            db.execute("INSERT OR IGNORE INTO meta VALUES ('schema','1')")
        self.path.chmod(0o600)

    def get_meta(self, key: str, default=None):
        with self.connection() as db:
            row = db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
            return json.loads(row[0]) if row else default

    def set_meta(self, key: str, value):
        with self.connection() as db:
            db.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (key, json.dumps(value)))

    def synchronize_feeds(self, groups: dict[str, str], excluded: frozenset[str]):
        if not groups:
            raise ValueError("An empty group response cannot disable subscriptions")
        with self.connection() as db:
            db.execute("UPDATE feeds SET enabled=0")
            for slug, name in groups.items():
                db.execute(
                    "INSERT INTO feeds(slug,name,enabled,initialized) VALUES (?,?,?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name,enabled=excluded.enabled",
                    (slug, name, slug not in excluded, 0),
                )

    def feeds(self) -> list[dict]:
        with self.connection() as db:
            return [dict(row) for row in db.execute("SELECT * FROM feeds WHERE enabled=1 ORDER BY last_poll,slug")]

    def feed_error(self, slug: str, error: str, now: float):
        with self.connection() as db:
            db.execute("UPDATE feeds SET last_poll=?,error=? WHERE slug=?", (now, error, slug))

    def ingest(self, slug: str, entries: list[dict], now: float, *, history: bool) -> int:
        count = 0
        with self.connection() as db:
            for entry in entries:
                key = entry["key"]
                if db.execute("SELECT 1 FROM seen_keys WHERE key=?", (key,)).fetchone():
                    continue
                reason = "initial history" if history else entry.get("ignore", "")
                if reason:
                    db.execute("INSERT OR IGNORE INTO seen_keys VALUES (?,?)", (key, reason))
                    continue
                count += db.execute(
                    "INSERT OR IGNORE INTO releases(key,slug,title,url,metadata,published,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'pending',?,?)",
                    (
                        key,
                        slug,
                        entry["title"],
                        entry["url"],
                        json.dumps(entry["metadata"], ensure_ascii=False),
                        entry["published"],
                        now,
                        now,
                    ),
                ).rowcount
            db.execute(
                "UPDATE feeds SET initialized=1,last_poll=?,last_success=?,error='' WHERE slug=?", (now, now, slug)
            )
        return count

    def due_releases(self, status: str, now: float, limit: int) -> list[dict]:
        with self.connection() as db:
            return [
                dict(row)
                for row in db.execute(
                    "SELECT * FROM releases WHERE status=? AND next_attempt<=? ORDER BY created_at,key LIMIT ?",
                    (status, now, limit),
                )
            ]

    def release_ready(self, key: str, infohash: str, content: bytes | None, save_path: str, tags: str, now: float):
        with self.connection() as db:
            duplicate = db.execute(
                "SELECT 1 FROM releases WHERE key<>? AND infohash=? AND status IN ('ready','submitted','confirmed')",
                (key, infohash),
            ).fetchone()
            if duplicate:
                db.execute(
                    "UPDATE releases SET status='ignored',content=NULL,error='duplicate infohash',updated_at=? WHERE key=?",
                    (now, key),
                )
                db.execute("INSERT OR REPLACE INTO seen_keys VALUES (?,'duplicate infohash')", (key,))
            else:
                db.execute(
                    "UPDATE releases SET status='ready',infohash=?,content=?,save_path=?,tags=?,updated_at=?,error='',attempts=0,next_attempt=0 WHERE key=?",
                    (infohash, content, save_path, tags, now, key),
                )

    def ignore_release(self, key: str, reason: str, now: float):
        with self.connection() as db:
            db.execute(
                "UPDATE releases SET status='ignored',content=NULL,error=?,updated_at=? WHERE key=?", (reason, now, key)
            )
            db.execute("INSERT OR REPLACE INTO seen_keys VALUES (?,?)", (key, reason))

    def retry_release(self, key: str, error: str, now: float):
        with self.connection() as db:
            attempts = db.execute("SELECT attempts FROM releases WHERE key=?", (key,)).fetchone()[0] + 1
            delay = min(3600, 30 * 2 ** min(attempts, 7))
            db.execute(
                "UPDATE releases SET attempts=?,next_attempt=?,error=?,updated_at=? WHERE key=?",
                (attempts, now + delay, error, now, key),
            )

    def submitting(self, key: str, now: float):
        # Persist before the HTTP mutation: a process crash leaves an ambiguous submission,
        # reconciled by its exact infohash on restart before any retry.
        with self.connection() as db:
            db.execute(
                "UPDATE releases SET status='submitted',submitted_at=?,updated_at=?,attempts=attempts+1,error='' WHERE key=? AND status='ready'",
                (now, now, key),
            )

    def reconcile_downloads(self, hashes: set[str], now: float, confirmation_seconds: float) -> list[dict]:
        confirmed = []
        with self.connection() as db:
            for row in db.execute(
                "SELECT key,infohash,status,title,attempts,submitted_at FROM releases WHERE status IN ('ready','submitted')"
            ).fetchall():
                if row["infohash"] in hashes:
                    db.execute(
                        "UPDATE releases SET status='confirmed',content=NULL,updated_at=?,error='' WHERE key=?",
                        (now, row["key"]),
                    )
                    db.execute("INSERT OR REPLACE INTO seen_keys VALUES (?,'confirmed')", (row["key"],))
                    if row["status"] == "submitted":
                        confirmed.append(dict(row))
                        db.execute(
                            "INSERT INTO events(ts,kind,details) VALUES (?,'download',?)",
                            (
                                now,
                                json.dumps(
                                    {"key": row["key"], "hash": row["infohash"], "title": row["title"]},
                                    ensure_ascii=False,
                                ),
                            ),
                        )
                elif row["status"] == "submitted" and now - row["submitted_at"] >= confirmation_seconds:
                    delay = min(3600, 30 * 2 ** min(row["attempts"], 7))
                    db.execute(
                        "UPDATE releases SET status='ready',next_attempt=?,error='not observed after submission',updated_at=? WHERE key=?",
                        (now + delay, now, row["key"]),
                    )
        return confirmed

    def observe(self, snapshot: Snapshot, *, media_enabled: bool, managed_hashes: set[str]) -> dict[str, Exposure]:
        now = snapshot.observed_at
        with self.connection() as db:
            previous = {row["hash"]: row for row in db.execute("SELECT * FROM exposures")}
            media_rows = (
                {row["hash"]: row for row in db.execute("SELECT hash,status,save_path,error FROM media")}
                if media_enabled
                else {}
            )
            changes = []
            for torrent in snapshot.torrents:
                old = previous.get(torrent.hash)
                active = torrent.state in SEEDING
                started = (old["started_at"] or now) if old and active else (now if active else 0)
                last = max(started, old["last_started_at"] if old else 0)
                if not old or old["started_at"] != started:
                    changes.append((torrent.hash, started, last, now))
                if (
                    media_enabled
                    and torrent.hash in managed_hashes
                    and torrent.progress >= 1
                    and torrent.state in SEEDING | {"forcedUP", "stoppedUP", "pausedUP"}
                ):
                    record = media_rows.get(torrent.hash)
                    if not record:
                        db.execute(
                            "INSERT INTO media(hash,name,save_path,updated_at) VALUES (?,?,?,?)",
                            (torrent.hash, torrent.name, torrent.save_path, now),
                        )
                    elif record["status"] in {"manifest", "ready"} and record["save_path"] != torrent.save_path:
                        db.execute("UPDATE media SET save_path=? WHERE hash=?", (torrent.save_path, torrent.hash))
                    elif record["status"] == "skipped" and record["error"] == "torrent unavailable":
                        db.execute(
                            "UPDATE media SET status='manifest',save_path=?,error='',next_attempt=0 WHERE hash=?",
                            (torrent.save_path, torrent.hash),
                        )
            if media_enabled:
                available = {
                    t.hash
                    for t in snapshot.torrents
                    if t.hash in managed_hashes and t.progress >= 1 and t.state != "missingFiles"
                }
                for row in db.execute("SELECT hash FROM media WHERE status IN ('manifest','ready')").fetchall():
                    if row[0] not in available:
                        db.execute(
                            "UPDATE media SET status='skipped',error='torrent unavailable',updated_at=? WHERE hash=?",
                            (now, row[0]),
                        )
            db.executemany("INSERT OR REPLACE INTO exposures VALUES (?,?,?,?)", changes)
            result = {
                row["hash"]: Exposure(row["started_at"], row["last_started_at"])
                for row in db.execute("SELECT * FROM exposures")
            }
            server = snapshot.server
            if "alltime_ul" in server and "alltime_dl" in server:
                sample = {"up": int(server["alltime_ul"]), "down": int(server["alltime_dl"]), "ts": now}
                row = db.execute("SELECT value FROM meta WHERE key='traffic_counter'").fetchone()
                if row:
                    old = json.loads(row[0])
                    if now > old["ts"]:
                        db.execute(
                            "INSERT INTO traffic VALUES (?,?,?,?)",
                            (
                                now,
                                max(0, sample["up"] - old["up"]),
                                max(0, sample["down"] - old["down"]),
                                now - old["ts"],
                            ),
                        )
                db.execute("INSERT OR REPLACE INTO meta VALUES ('traffic_counter',?)", (json.dumps(sample),))
        return result

    def event(self, kind: str, details: dict, now: float):
        with self.connection() as db:
            db.execute(
                "INSERT INTO events(ts,kind,details) VALUES (?,?,?)",
                (now, kind, json.dumps(details, ensure_ascii=False)),
            )

    def traffic_totals(self, now: float) -> tuple[int, int]:
        with self.connection() as db:
            return tuple(
                db.execute("SELECT COALESCE(SUM(uploaded),0) FROM traffic WHERE ts>=?", (now - span,)).fetchone()[0]
                for span in (3600, 86400)
            )

    def media_due(self, statuses: tuple[str, ...], now: float, limit: int = 1) -> list[dict]:
        with self.connection() as db:
            placeholders = ",".join("?" for _ in statuses)
            return [
                dict(row)
                for row in db.execute(
                    f"SELECT * FROM media WHERE status IN ({placeholders}) AND next_attempt<=? ORDER BY CASE status WHEN 'upload' THEN 0 ELSE 1 END,updated_at,hash LIMIT ?",
                    (*statuses, now, limit),
                )
            ]

    def media_stage(self, infohash: str, status: str, now: float, *, files=None, payload=None):
        with self.connection() as db:
            if (
                status == "skipped"
                and db.execute("SELECT 1 FROM media WHERE hash=? AND status='done'", (infohash,)).fetchone()
            ):
                return
            db.execute(
                "UPDATE media SET status=?,files=COALESCE(?,files),payload=?,updated_at=?,error='',attempts=0,next_attempt=0 WHERE hash=?",
                (
                    status,
                    json.dumps(files) if files is not None else None,
                    json.dumps(payload, ensure_ascii=False) if payload is not None else None,
                    now,
                    infohash,
                ),
            )

    def media_retry(self, infohash: str, error: str, now: float, minimum_delay: float = 60):
        with self.connection() as db:
            row = db.execute("SELECT attempts FROM media WHERE hash=?", (infohash,)).fetchone()
            attempts = row[0] + 1
            delay = min(86400, max(minimum_delay, 60 * 2 ** min(attempts, 10)))
            db.execute(
                "UPDATE media SET attempts=?,next_attempt=?,error=?,updated_at=? WHERE hash=?",
                (attempts, now + delay, error, now, infohash),
            )

    def stats(self) -> dict:
        with self.connection() as db:
            return {
                "downloads": dict(db.execute("SELECT status,COUNT(*) FROM releases GROUP BY status")),
                "media": dict(db.execute("SELECT status,COUNT(*) FROM media GROUP BY status")),
                "feeds_enabled": db.execute("SELECT COUNT(*) FROM feeds WHERE enabled=1").fetchone()[0],
                "feeds_failed": db.execute("SELECT COUNT(*) FROM feeds WHERE enabled=1 AND error<>''").fetchone()[0],
                "retrying_downloads": db.execute(
                    "SELECT COUNT(*) FROM releases WHERE status IN ('pending','ready','submitted') AND error<>''"
                ).fetchone()[0],
                "retrying_media": db.execute(
                    "SELECT COUNT(*) FROM media WHERE status NOT IN ('done','skipped') AND error<>''"
                ).fetchone()[0],
            }

    def maintain(self, now: float, history_days: int):
        with self.connection() as db:
            cutoff = now - history_days * 86400
            db.execute("DELETE FROM traffic WHERE ts<?", (cutoff,))
            db.execute("DELETE FROM events WHERE ts<?", (cutoff,))
            # Identities and successful media receipts are intentionally durable.
            db.execute("DELETE FROM releases WHERE status IN ('confirmed','ignored') AND updated_at<?", (cutoff,))
