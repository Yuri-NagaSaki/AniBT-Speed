import unittest

from app.cleanup import plan_cleanup, plan_rate
from app.domain import Exposure, StoragePressure
from app.queue import plan_queue
from tests.support import settings, torrent

NOW = 20_000_000


class PolicyTests(unittest.TestCase):
    def test_scope_excludes_other_categories_paths_keep_and_forced_states(self):
        samples = (
            torrent(1, category="Other"),
            torrent(2, save_path="/media/AniBT-backup"),
            torrent(3, tags=frozenset({"keep"})),
            torrent(4, state="forcedUP"),
            torrent(5, state="missingFiles"),
            torrent(6, progress=0.9, state="downloading"),
            torrent(7, save_path="/media/AniBT/../other"),
        )
        self.assertEqual(plan_queue(samples, settings(), {}, NOW), [])
        self.assertEqual(plan_cleanup(samples, settings(), StoragePressure(0, 100), NOW), [])

    def test_completion_time_protects_slow_downloads_and_unknown_age(self):
        samples = (torrent(1, completion_on=NOW - 60), torrent(2, completion_on=0))
        self.assertEqual(plan_cleanup(samples, settings(), StoragePressure(0, 100), NOW), [])

    def test_pool_is_soft_for_demand_and_newly_completed_torrents(self):
        samples = (
            torrent(1, state="uploading", upspeed=100),
            torrent(2, state="stalledUP", completion_on=NOW - 100),
            torrent(3, num_leechs=1),
        )
        plan = plan_queue(samples, settings(pool_target=1), {}, NOW)
        self.assertEqual([command.kind for command in plan], ["resume"])
        self.assertEqual(plan[0].hashes, (samples[2].hash,))

    def test_rotation_has_exposure_window_and_can_be_throttled(self):
        active, paused = torrent(1, state="stalledUP"), torrent(2)
        cfg = settings(pool_target=1, hot_hours=0, exposure_seconds=600)
        fresh = {active.hash: Exposure(NOW - 10, NOW - 10)}
        self.assertEqual(plan_queue((active, paused), cfg, fresh, NOW), [])
        old = {active.hash: Exposure(NOW - 700, NOW - 700)}
        self.assertEqual(plan_queue((active, paused), cfg, old, NOW, rotate=False), [])
        self.assertEqual([command.kind for command in plan_queue((active, paused), cfg, old, NOW)], ["pause", "resume"])

    def test_least_recently_exposed_order_survives_library_changes(self):
        samples = tuple(torrent(index) for index in range(1, 5))
        history = {
            samples[0].hash: Exposure(0, 1000),
            samples[1].hash: Exposure(0, 100),
            samples[2].hash: Exposure(0, 500),
        }
        plan = plan_queue(samples, settings(pool_target=2, hot_hours=0), history, NOW)
        self.assertEqual(plan[0].hashes, (samples[3].hash, samples[1].hash))

    def test_transitioning_and_forced_torrents_reserve_pool_capacity(self):
        samples = (torrent(1, state="checkingUP"), torrent(2, state="forcedUP"), torrent(3))
        self.assertEqual(plan_queue(samples, settings(pool_target=2, hot_hours=0), {}, NOW), [])

    def test_space_cleanup_is_one_at_a_time_and_retention_is_bounded(self):
        samples = tuple(torrent(index) for index in range(1, 20))
        self.assertEqual(len(plan_cleanup(samples, settings(), StoragePressure(0, 100), NOW)), 1)
        self.assertEqual(len(plan_cleanup(samples, settings(cleanup_batch=3), StoragePressure(10**15), NOW)), 3)

    def test_active_uploads_are_not_deleted(self):
        samples = (torrent(1, upspeed=1), torrent(2, num_leechs=1))
        self.assertEqual(plan_cleanup(samples, settings(), StoragePressure(0, 100), NOW), [])

    def test_shared_and_nested_content_paths_are_never_deleted(self):
        samples = (
            torrent(1, content_path="/media/AniBT/shared"),
            torrent(2, content_path="/media/AniBT/shared/a.mkv"),
            torrent(3, content_path="/media/AniBT/shared/z.mkv", category="Other"),
            torrent(4, content_path="/media/AniBT/shared/a.mkv"),
        )
        self.assertEqual(plan_cleanup(samples, settings(), StoragePressure(0, 100), NOW), [])

    def test_rate_only_sends_changes_and_uses_counter_windows(self):
        cfg = settings(rate_enabled=True, hourly_upload_gib=1)
        self.assertEqual(plan_rate({"up_rate_limit": 100 * 1024**2, "dl_rate_limit": 0}, cfg, 0, 0), [])
        plan = plan_rate({}, cfg, 2 * 1024**3, 0)
        self.assertEqual([command.values["limit"] for command in plan], [1024, 1024])
