"""Explicit, idempotent import of receipts; never used by the worker runtime."""

import sqlite3
import time
from pathlib import Path
from urllib.parse import urlsplit

from app.feeds import canonical_key
from app.store import Store


def import_receipts(store: Store, rss_history: Path | None, media_history: Path | None) -> dict:
    counts = {"release_receipts": 0, "media_receipts": 0}
    with store.connection() as target:
        if rss_history:
            source = sqlite3.connect(f"file:{rss_history.resolve()}?mode=ro", uri=True)
            try:
                for guid, link in source.execute("SELECT guid,link FROM rss_processed_items"):
                    for value in (guid, link):
                        if value:
                            counts["release_receipts"] += target.execute(
                                "INSERT OR IGNORE INTO seen_keys VALUES (?,'imported')", (canonical_key(value),)
                            ).rowcount
                if source.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rss_feeds'").fetchone():
                    for name, url in source.execute("SELECT name,url FROM rss_feeds"):
                        path = urlsplit(url).path
                        if path.startswith("/rss/group/") and path.endswith(".xml"):
                            slug = path.removeprefix("/rss/group/").removesuffix(".xml")
                            target.execute(
                                "INSERT OR IGNORE INTO feeds(slug,name,enabled,initialized) VALUES (?,?,0,1)",
                                (slug, name),
                            )
            finally:
                source.close()
        if media_history:
            source = sqlite3.connect(f"file:{media_history.resolve()}?mode=ro", uri=True)
            try:
                # Only successful receipts migrate. Old temporary/permanent failure limits
                # do not suppress work in the new queue.
                for (infohash,) in source.execute("SELECT info_hash FROM processed WHERE sent=1"):
                    counts["media_receipts"] += target.execute(
                        "INSERT OR IGNORE INTO media(hash,status,updated_at) VALUES (?,'done',?)",
                        (infohash.lower(), time.time()),
                    ).rowcount
            finally:
                source.close()
    return counts
