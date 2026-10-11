import asyncio
import time
import unittest

import httpx

from app.domain import Command
from app.qbt import QBTClient, QBTError
from tests.support import settings

HASH = "a" * 40


class QBTTests(unittest.IsolatedAsyncioTestCase):
    async def test_incremental_merge_removal_and_server_restart(self):
        replies = [
            {
                "rid": 1,
                "full_update": True,
                "torrents": {HASH: {"name": "a", "state": "uploading", "upspeed": 10}},
                "server_state": {"alltime_ul": 100},
                "categories": {"AniBT": {}},
            },
            {"rid": 2, "torrents": {HASH: {"upspeed": 20}}},
            {"rid": 3, "torrents_removed": [HASH]},
            {"rid": 1, "full_update": True, "server_state": {"alltime_ul": 1}},
        ]
        calls = []

        async def handler(request):
            calls.append(request)
            return httpx.Response(200, json=replies.pop(0))

        client = QBTClient(settings(), transport=httpx.MockTransport(handler))
        self.addAsyncCleanup(client.close)
        first = await client.snapshot()
        second = await client.snapshot()
        self.assertEqual(first.torrents[0].upspeed, 10)
        self.assertEqual(second.torrents[0].upspeed, 20)
        self.assertEqual(second.torrents[0].name, "a")
        self.assertEqual((await client.snapshot()).torrents, ())
        self.assertEqual((await client.snapshot()).server["alltime_ul"], 1)
        self.assertEqual([r.url.params["rid"] for r in calls], ["0", "1", "2", "3"])
        self.assertEqual(calls[0].headers["authorization"], "Bearer test-key")
        self.assertEqual({r.url.path for r in calls}, {"/api/v2/sync/maindata"})

    async def test_timeout_has_one_attempt_and_releases_lock(self):
        calls = []

        async def handler(request):
            calls.append(request)
            if len(calls) == 1:
                await asyncio.sleep(10)
            return httpx.Response(200, json={"rid": 1, "full_update": True})

        client = QBTClient(settings(qbt_timeout_seconds=0.02), transport=httpx.MockTransport(handler))
        self.addAsyncCleanup(client.close)
        started = time.monotonic()
        with self.assertRaises(QBTError):
            await client.snapshot()
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertEqual(len(calls), 1)
        await client.snapshot()
        self.assertEqual(len(calls), 2)

    async def test_never_retries_or_follows_redirects(self):
        for status in (302, 401, 403, 500):
            calls = []

            async def handler(request):
                calls.append(request)
                return httpx.Response(status, headers={"Location": "http://different.test/"})

            client = QBTClient(settings(qbt_url="https://qbt.test"), transport=httpx.MockTransport(handler))
            with self.assertRaises(QBTError):
                await client.snapshot()
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0].url.scheme, "https")
            await client.close()

    async def test_invalid_baseline_and_dangerous_hash_are_rejected(self):
        for payload in (
            {"rid": 1},
            {"rid": True, "full_update": True},
            {"rid": 1, "full_update": True, "torrents": {"all": {}}},
        ):
            client = QBTClient(settings(), transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload)))
            with self.assertRaises(QBTError):
                await client.snapshot()
            await client.close()

    async def test_failed_add_is_not_success_and_read_only_blocks_mutation(self):
        command = Command(
            "add", values={"save_path": "/media/AniBT", "tags": "AniBT", "url": "magnet:?xt=urn:btih:" + HASH}
        )
        client = QBTClient(settings(), transport=httpx.MockTransport(lambda _: httpx.Response(200, content=b"Fails.")))
        with self.assertRaises(QBTError):
            await client.execute(command)
        await client.close()
        client = QBTClient(settings(), read_only=True)
        with self.assertRaises(QBTError):
            await client.execute(command)
        self.assertEqual(sum(client.requests.values()), 0)
        await client.close()

    async def test_writes_use_qb_five_start_stop_and_batch(self):
        calls = []

        def handler(request):
            calls.append((request.url.path, request.content))
            return httpx.Response(200)

        client = QBTClient(settings(), transport=httpx.MockTransport(handler))
        await client.execute(Command("pause", (HASH, "b" * 40)))
        await client.execute(Command("resume", (HASH,)))
        self.assertEqual([path for path, _ in calls], ["/api/v2/torrents/stop", "/api/v2/torrents/start"])
        self.assertIn(b"%7C", calls[0][1])
        await client.close()

    async def test_qb_52_structured_add_acknowledgement(self):
        command = Command(
            "add", (HASH,), values={"save_path": "/media/AniBT", "tags": "AniBT", "url": "magnet:?xt=urn:btih:" + HASH}
        )
        replies = [
            {"success_count": 1, "failure_count": 0, "pending_count": 0, "added_torrent_ids": [HASH]},
            {"success_count": 0, "failure_count": 0, "pending_count": 1, "added_torrent_ids": []},
            {"success_count": 1, "failure_count": 0, "pending_count": 0, "added_torrent_ids": ["b" * 40]},
            {"success_count": 0, "failure_count": 1, "pending_count": 0, "added_torrent_ids": []},
        ]
        client = QBTClient(
            settings(), transport=httpx.MockTransport(lambda _: httpx.Response(200, json=replies.pop(0)))
        )
        self.addAsyncCleanup(client.close)
        await client.execute(command)
        await client.execute(command)
        for _ in range(2):
            with self.assertRaises(QBTError):
                await client.execute(command)
