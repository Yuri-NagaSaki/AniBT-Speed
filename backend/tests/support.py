import tempfile
import time
import unittest
from dataclasses import replace
from pathlib import Path

from app.config import Settings
from app.domain import Torrent
from app.store import Store


def settings(**overrides):
    values = {"qbt_url": "http://qbt.test", "qbt_api_key": "test-key", "anibt_api_url": "http://anibt.test"}
    values.update(overrides)
    return Settings(_env_file=None, **values)


def torrent(index=1, **changes):
    base = Torrent(
        f"{index:040x}",
        name=f"Show {index}",
        state="stoppedUP",
        category="AniBT",
        save_path="/media/AniBT/Group",
        content_path=f"/media/AniBT/Group/{index}.mkv",
        progress=1,
        added_on=1,
        completion_on=1,
        size=1024,
    )
    return replace(base, **changes)


class StoreCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(Path(self.temp.name) / "state.sqlite3")
        self.store.initialize()
        self.addCleanup(self.store.close)

    def release(self, key="release-1", **changes):
        self.store.synchronize_feeds({"group": "Group"}, frozenset())
        entry = {
            "key": key,
            "title": "Identical title",
            "url": "http://anibt.test/torrent.torrent",
            "metadata": {
                "group_slug": "group",
                "group_name": "Group",
                "anime_title": "Anime",
                "bgm_id": "",
                "release_title": "Release",
            },
            "published": time.time(),
        }
        entry.update(changes)
        self.store.ingest("group", [entry], time.time(), history=False)
        return entry


class AsyncStoreCase(StoreCase, unittest.IsolatedAsyncioTestCase):
    pass
