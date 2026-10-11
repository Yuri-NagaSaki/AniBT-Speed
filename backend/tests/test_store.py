import sqlite3
import time
from pathlib import Path

from app.domain import Snapshot
from app.migrate import import_receipts
from tests.support import StoreCase, torrent


class StoreTests(StoreCase):
    def test_title_is_not_an_identity(self):
        self.release("one")
        self.release("two")
        self.release("one")
        self.assertEqual(self.store.stats()["downloads"], {"pending": 2})

    def test_submission_is_reconciled_by_hash_and_survives_restart(self):
        self.release()
        self.store.release_ready("release-1", torrent().hash, b"content", "/media/AniBT", "AniBT", 1)
        self.store.submitting("release-1", 2)
        self.store.initialize()
        self.assertEqual(self.store.reconcile_downloads(set(), 50, 120), [])
        self.assertEqual(self.store.stats()["downloads"], {"submitted": 1})
        confirmed = self.store.reconcile_downloads({torrent().hash}, 51, 120)
        self.assertEqual(len(confirmed), 1)
        self.assertEqual(self.store.stats()["downloads"], {"confirmed": 1})
        self.assertEqual(self.store.reconcile_downloads({torrent().hash}, 52, 120), [])

    def test_unobserved_add_returns_to_queue_only_after_grace_and_backoff(self):
        self.release()
        self.store.release_ready("release-1", torrent().hash, b"content", "/media/AniBT", "AniBT", 1)
        self.store.submitting("release-1", 2)
        self.store.reconcile_downloads(set(), 123, 120)
        self.assertEqual(self.store.due_releases("ready", 123, 10), [])
        self.assertEqual(len(self.store.due_releases("ready", 1000, 10)), 1)

    def test_failed_discovery_cannot_disable_feeds(self):
        self.store.synchronize_feeds({"allowed": "Allowed", "ani": "ANi"}, frozenset({"ani"}))
        with self.assertRaises(ValueError):
            self.store.synchronize_feeds({}, frozenset())
        self.assertEqual([feed["slug"] for feed in self.store.feeds()], ["allowed"])

    def test_migrated_feeds_keep_history_but_future_feeds_still_bootstrap(self):
        source = Path(self.temp.name) / "history.db"
        with sqlite3.connect(source) as db:
            db.executescript(
                "CREATE TABLE rss_processed_items(guid TEXT,link TEXT); CREATE TABLE rss_feeds(name TEXT,url TEXT)"
            )
            db.execute("INSERT INTO rss_feeds VALUES ('Known','https://anibt.net/rss/group/known.xml')")
        import_receipts(self.store, source, None)
        self.store.synchronize_feeds({"known": "Known", "new": "New"}, frozenset())
        self.assertEqual({feed["slug"]: feed["initialized"] for feed in self.store.feeds()}, {"known": 1, "new": 0})

    def test_bootstrap_is_persisted_per_feed_not_per_process(self):
        self.release()
        self.assertEqual(self.store.feeds()[0]["initialized"], 1)
        self.store.initialize()
        self.store.synchronize_feeds({"group": "Renamed"}, frozenset())
        self.assertEqual(self.store.feeds()[0]["initialized"], 1)

    def test_traffic_uses_real_counters_and_handles_reset(self):
        for ts, up, down in ((100, 1000, 100), (280, 1700, 200), (300, 3, 1)):
            self.store.observe(
                Snapshot((), {"alltime_ul": up, "alltime_dl": down}, ts), media_enabled=False, managed_hashes=set()
            )
        self.assertEqual(self.store.traffic_totals(301), (700, 700))

    def test_import_is_idempotent_and_success_only(self):
        source = Path(self.temp.name) / "old.db"
        with sqlite3.connect(source) as db:
            db.executescript(
                "CREATE TABLE rss_processed_items(guid TEXT,link TEXT); CREATE TABLE processed(info_hash TEXT,sent INTEGER)"
            )
            db.execute(
                "INSERT INTO rss_processed_items VALUES ('https://anibt.net/release/rel_1','https://anibt.net/api/torrent/rel_1.torrent')"
            )
            db.executemany(
                "INSERT INTO processed VALUES (?,?)", [(torrent().hash, 1), (torrent(2).hash, 0), (torrent(3).hash, -1)]
            )
        first = import_receipts(self.store, source, source)
        second = import_receipts(self.store, source, source)
        self.assertEqual(first, {"release_receipts": 2, "media_receipts": 1})
        self.assertEqual(second, {"release_receipts": 0, "media_receipts": 0})
        self.release("rel_1")
        self.assertEqual(self.store.stats()["downloads"], {})
        self.assertEqual(self.store.stats()["media"], {"done": 1})

    def test_exposure_survives_restart(self):
        sample = torrent(state="stalledUP")
        self.store.observe(Snapshot((sample,), {}, 1000), media_enabled=False, managed_hashes=set())
        self.store.close()
        self.store.initialize()
        history = self.store.observe(Snapshot((sample,), {}, 1100), media_enabled=False, managed_hashes=set())
        self.assertEqual(history[sample.hash].started_at, 1000)

    def test_concurrent_local_transactions_do_not_compete_for_sqlite_writer(self):
        from concurrent.futures import ThreadPoolExecutor

        def insert(index):
            self.store.event("test", {"index": index}, index)
            return self.store.stats()

        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(insert, range(100)))
        with self.store.connection() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 100)

    def test_media_queue_has_durable_backoff(self):
        sample = torrent()
        self.store.observe(Snapshot((sample,), {}, time.time()), media_enabled=True, managed_hashes={sample.hash})
        self.store.media_retry(sample.hash, "offline", 100)
        self.assertEqual(self.store.media_due(("manifest",), 101), [])
        self.assertEqual(len(self.store.media_due(("manifest",), 100000)), 1)
