import calendar
import hashlib
import time

import feedparser
import httpx

from app.feeds import FeedPipeline, SourceError, rss_entry
from app.torrent import magnet_hash, torrent_identity
from tests.support import AsyncStoreCase, StoreCase, settings

INFO = b"d6:lengthi123e4:name8:test.mkv12:piece lengthi16384e6:pieces20:abcdefghijklmnopqrste"
TORRENT = b"d4:info" + INFO + b"e"


class FeedTests(AsyncStoreCase):
    async def test_default_exclusions_and_discovery_failure_preserve_existing_feeds(self):
        cfg = settings()
        self.assertEqual(
            cfg.excluded_groups, frozenset({"ani", "kirara-fantasia", "zzz123", "pre-s", "silent-workshop"})
        )
        groups = [{"slug": slug, "name": slug} for slug in (*cfg.excluded_groups, "allowed")]
        response = {"data": groups}
        pipeline = FeedPipeline(
            cfg, self.store, transport=httpx.MockTransport(lambda _: httpx.Response(200, json=response))
        )
        self.addAsyncCleanup(pipeline.close)
        await pipeline.synchronize()
        self.assertEqual([feed["slug"] for feed in self.store.feeds()], ["allowed"])
        response["data"] = []
        with self.assertRaises(SourceError):
            await pipeline.synchronize()
        self.assertEqual([feed["slug"] for feed in self.store.feeds()], ["allowed"])

    async def test_preparation_downloads_once_and_persists_exact_identity(self):
        self.release()
        calls = []

        def handler(request):
            calls.append(request.url.path)
            return httpx.Response(200, content=TORRENT)

        pipeline = FeedPipeline(settings(), self.store, transport=httpx.MockTransport(handler))
        self.addAsyncCleanup(pipeline.close)
        await pipeline.prepare()
        await pipeline.prepare()
        job = self.store.due_releases("ready", time.time(), 1)[0]
        self.assertEqual(job["infohash"], hashlib.sha1(INFO).hexdigest())
        self.assertEqual(job["content"], TORRENT)
        self.assertEqual(calls, ["/torrent.torrent"])

    async def test_failed_torrent_fetch_does_not_acknowledge_release(self):
        self.release()
        pipeline = FeedPipeline(settings(), self.store, transport=httpx.MockTransport(lambda _: httpx.Response(503)))
        self.addAsyncCleanup(pipeline.close)
        await pipeline.prepare()
        self.assertEqual(self.store.stats()["downloads"], {"pending": 1})
        self.assertEqual(self.store.stats()["retrying_downloads"], 1)

    async def test_restart_does_not_bootstrap_away_unseen_new_items(self):
        self.store.synchronize_feeds({"group": "Group"}, frozenset())
        self.store.ingest("group", [], time.time(), history=True)
        published = time.strftime("%a, %d %b %Y %H:%M:%S GMT", time.gmtime())
        xml = f'<rss version="2.0" xmlns:anibt="https://anibt.net/xmlns/rss/1.0/"><channel><title>Group</title><item><title>New</title><guid>new-id</guid><pubDate>{published}</pubDate><anibt:torrentUrl>http://anibt.test/new.torrent</anibt:torrentUrl></item></channel></rss>'

        def handler(request):
            if request.url.path == "/api/subtitle-groups":
                return httpx.Response(200, json={"data": [{"slug": "group", "name": "Group"}]})
            return httpx.Response(200, content=xml)

        pipeline = FeedPipeline(settings(), self.store, transport=httpx.MockTransport(handler))
        self.addAsyncCleanup(pipeline.close)
        await pipeline.poll()
        self.assertEqual(self.store.stats()["downloads"], {"pending": 1})


class EntryTests(StoreCase):
    def test_age_gate_group_identity_and_query_torrent_url(self):
        stamp = time.gmtime()
        entry = {
            "id": "rel-1",
            "title": "Title",
            "published_parsed": stamp,
            "anibt_torrenturl": "https://anibt.test/x.torrent?signature=example",
            "anibt_groupslug": "group",
        }
        feed = {"slug": "group", "name": "Group"}
        now = calendar.timegm(stamp)
        value = rss_entry(entry, feed, settings(), now)
        self.assertEqual(value["ignore"], "")
        self.assertIn("?signature=", value["url"])
        self.assertEqual(rss_entry(entry, feed, settings(), now + 100 * 3600)["ignore"], "release too old")
        self.assertEqual(
            rss_entry(entry, {"slug": "other", "name": "Other"}, settings(), now)["ignore"], "group identity mismatch"
        )

    def test_ambiguous_title_and_missing_dates_are_not_terminal_receipts(self):
        entry = {"title": "same title", "link": "https://anibt.test/release/page"}
        self.assertIsNone(rss_entry(entry, {"slug": "group", "name": "Group"}, settings(), time.time()))

    def test_entire_feed_is_considered_not_only_newest_five(self):
        entries = [
            {"key": str(index), "title": "same", "url": "http://anibt.test/x.torrent", "metadata": {}, "published": 1}
            for index in range(20)
        ]
        self.store.synchronize_feeds({"group": "Group"}, frozenset())
        self.store.ingest("group", entries[:5], 1, history=True)
        self.assertEqual(self.store.ingest("group", entries, 2, history=False), 15)

    def test_torrent_parser_preserves_info_bytes_and_rejects_malformed_data(self):
        self.assertEqual(torrent_identity(TORRENT), (hashlib.sha1(INFO).hexdigest(), 123))
        for content in (b"", b"not a torrent", b"d4:info", TORRENT + b"junk", b"d4:infoi1ee"):
            with self.assertRaises(ValueError):
                torrent_identity(content)
        self.assertEqual(magnet_hash("magnet:?xt=urn:btih:" + "A" * 40), "a" * 40)

    def test_namespaced_rss_fields_are_read_without_title_guessing(self):
        xml = b'<rss version="2.0" xmlns:anibt="https://anibt.net/xmlns/rss/1.0/"><channel><item><guid>id</guid><title>Release</title><anibt:groupSlug>group</anibt:groupSlug><anibt:torrentUrl>https://anibt.test/x.torrent</anibt:torrentUrl><anibt:animeTitle>Official title</anibt:animeTitle></item></channel></rss>'
        entry = feedparser.parse(xml).entries[0]
        value = rss_entry(entry, {"slug": "group", "name": "Group"}, settings(rss_max_age_hours=0), time.time())
        self.assertEqual(value["metadata"]["anime_title"], "Official title")
