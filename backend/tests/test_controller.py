import asyncio
import time
from collections import Counter
from unittest.mock import patch

from app.controller import Controller
from app.domain import Snapshot, StoragePressure
from app.qbt import QBTError
from tests.support import AsyncStoreCase, settings, torrent


class FakeQBT:
    def __init__(self, torrents=()):
        self.torrents = torrents
        self.requests = Counter()
        self.failures = self.bytes_received = 0
        self.full_updates = self.delta_updates = 0
        self.commands = []
        self.fail_snapshot = False
        self.fail_write = False

    async def snapshot(self):
        self.requests["snapshot"] += 1
        if self.fail_snapshot:
            raise QBTError("offline")
        return Snapshot(self.torrents, {"free_space_on_disk": 10**15}, time.time(), frozenset({"AniBT"}))

    async def execute(self, command):
        self.requests["write"] += 1
        if self.fail_write:
            raise QBTError("ambiguous write")
        self.commands.append(command)


class ControllerTests(AsyncStoreCase):
    async def test_one_snapshot_for_all_policies(self):
        qbt = FakeQBT(tuple(torrent(index) for index in range(1, 1001)))
        controller = Controller(settings(cleanup_enabled=False), self.store, qbt)
        await controller.cycle()
        self.assertEqual(qbt.requests["snapshot"], 1)
        self.assertEqual(len(qbt.commands), 1)
        self.assertEqual(qbt.commands[0].kind, "resume")
        self.assertEqual(len(qbt.commands[0].hashes), 40)

    async def test_snapshot_failure_blocks_all_mutations(self):
        qbt = FakeQBT((torrent(),))
        qbt.fail_snapshot = True
        controller = Controller(settings(), self.store, qbt)
        with self.assertRaises(QBTError):
            await controller.cycle()
        self.assertEqual(qbt.commands, [])

    async def test_failed_add_is_pending_confirmation_not_acknowledged(self):
        self.release()
        self.store.release_ready("release-1", torrent().hash, b"torrent", "/media/AniBT", "AniBT", time.time())
        qbt = FakeQBT()
        qbt.fail_write = True
        controller = Controller(settings(pool_enabled=False, cleanup_enabled=False), self.store, qbt)
        with self.assertRaises(QBTError):
            await controller.cycle()
        self.assertEqual(self.store.stats()["downloads"], {"submitted": 1})
        qbt.fail_write = False
        qbt.torrents = (torrent(),)
        await controller.cycle()
        self.assertEqual(self.store.stats()["downloads"], {"confirmed": 1})
        self.assertEqual(qbt.commands, [])

    async def test_cleanup_targets_are_not_resumed_from_old_snapshot(self):
        qbt = FakeQBT((torrent(),))
        controller = Controller(settings(), self.store, qbt)
        await controller.cycle()
        self.assertEqual([command.kind for command in qbt.commands], ["delete"])

    async def test_command_count_is_bounded(self):
        qbt = FakeQBT(tuple(torrent(index) for index in range(1, 20)))
        controller = Controller(settings(control_max_commands=2, cleanup_batch=10), self.store, qbt)
        await controller.cycle()
        self.assertEqual(len(qbt.commands), 2)

    async def test_dry_run_does_not_send_commands(self):
        qbt = FakeQBT((torrent(),))
        controller = Controller(settings(dry_run=True), self.store, qbt)
        await controller.cycle()
        self.assertEqual(qbt.commands, [])
        self.assertTrue(controller.last_plan)

    async def test_controller_deadline_and_overlap_guard(self):
        class SlowQBT(FakeQBT):
            async def snapshot(self):
                self.requests["snapshot"] += 1
                await asyncio.sleep(10)

        qbt = SlowQBT()
        controller = Controller(settings(control_budget_seconds=0.02), self.store, qbt)
        first = asyncio.create_task(controller.cycle())
        await asyncio.sleep(0)
        await controller.cycle()
        with self.assertRaises(TimeoutError):
            await first
        self.assertEqual(qbt.requests["snapshot"], 1)

    async def test_storage_pressure_blocks_new_admissions(self):
        self.release()
        self.store.release_ready("release-1", torrent().hash, b"torrent", "/media/AniBT", "AniBT", time.time())
        qbt = FakeQBT()
        controller = Controller(settings(), self.store, qbt)
        with patch("app.controller.storage_pressure", return_value=StoragePressure(0)):
            await controller.cycle()
        self.assertEqual(qbt.commands, [])
        self.assertEqual(self.store.stats()["downloads"], {"ready": 1})
