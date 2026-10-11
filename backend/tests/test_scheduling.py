import asyncio
import unittest

from app.scheduling import PeriodicJob


class SchedulingTests(unittest.IsolatedAsyncioTestCase):
    async def test_overlapping_calls_are_coalesced(self):
        entered = asyncio.Event()
        release = asyncio.Event()
        calls = []

        async def work():
            calls.append(1)
            entered.set()
            await release.wait()

        job = PeriodicJob("test", work, 1, 10)
        first = asyncio.create_task(job.once())
        await entered.wait()
        await asyncio.gather(*(job.once() for _ in range(20)))
        release.set()
        await first
        self.assertEqual(len(calls), 1)
        self.assertEqual(job.state.runs, 1)

    async def test_hung_work_is_cancelled_and_next_run_recovers(self):
        calls = []
        cancelled = []

        async def work():
            calls.append(1)
            if len(calls) == 1:
                try:
                    await asyncio.sleep(10)
                finally:
                    cancelled.append(1)

        job = PeriodicJob("test", work, 1, 0.02)
        await job.once()
        self.assertEqual(cancelled, [1])
        self.assertEqual(job.state.failures, 1)
        await job.once()
        self.assertIsNone(job.state.error)
        self.assertEqual(job.state.consecutive_failures, 0)
        self.assertIsNotNone(job.state.last_success)

    async def test_slow_control_does_not_block_feed_lane(self):
        completed = asyncio.Event()

        async def slow():
            await asyncio.sleep(10)

        async def fast():
            completed.set()

        control = PeriodicJob("control", slow, 1, 0.03)
        feed = PeriodicJob("feed", fast, 1, 1)
        running = asyncio.create_task(control.once())
        await feed.once()
        self.assertTrue(completed.is_set())
        self.assertFalse(running.done())
        await running
