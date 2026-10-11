import json
import time
from pathlib import Path

import httpx

from app.domain import Snapshot
from app.media import MediaPipeline, safe_media_path
from app.media_format import parse_tracks, payload_for_files, select_samples
from tests.support import AsyncStoreCase, StoreCase, settings, torrent

MEDIA = {
    "media": {
        "track": [
            {"@type": "General", "Format": "Matroska", "FileSize": "12345", "Duration": "24.5"},
            {"@type": "Video", "Format": "HEVC", "Width": "1920", "Height": "1080", "FrameRate": "23.976"},
            {"@type": "Audio", "Format": "AAC", "Channels": "2", "Default": "Yes"},
            {"@type": "Text", "Format": "ASS", "Language": "zh", "Forced": "No"},
        ]
    }
}


class MediaFormatTests(StoreCase):
    def test_paths_reject_sibling_prefix_traversal_and_symlinks(self):
        root = Path(self.temp.name) / "downloads"
        root.mkdir()
        good = root / "good.mkv"
        good.touch()
        outside = Path(self.temp.name) / "outside.mkv"
        outside.touch()
        (root / "escape.mkv").symlink_to(outside)
        self.assertEqual(safe_media_path(str(root), str(root), "good.mkv"), good)
        for relative in ("../outside.mkv", "escape.mkv", str(outside), "missing.mkv"):
            with self.assertRaises(ValueError):
                safe_media_path(str(root), str(root), relative)

    def test_collection_sampling_is_bounded_and_includes_largest(self):
        files = [{"name": f"{index:03d}.mkv", "size": index + 100} for index in range(100)]
        selected = select_samples(files, 6)
        self.assertEqual(len(selected), 6)
        self.assertIn(files[-1], selected)

    def test_partial_collection_does_not_invent_total_duration(self):
        files = [{"name": f"ep{index}.mkv", "size": 100} for index in range(3)]
        parsed = {"ep0.mkv": parse_tracks(MEDIA)}
        payload = payload_for_files("a" * 40, "Collection", files, parsed, 10000)
        self.assertNotIn("duration", payload["general"])
        self.assertIn("sampled: 1", payload["rawText"])
        self.assertEqual(payload["general"]["fileSize"], 300)

    def test_complete_collection_duration_and_payload_byte_limit(self):
        files = [{"name": f"文件{index}.mkv", "size": 100} for index in range(3)]
        parsed = {file["name"]: parse_tracks(MEDIA) for file in files}
        payload = payload_for_files("a" * 40, "Collection", files, parsed, 1500)
        self.assertEqual(payload["general"]["duration"], 73.5)
        self.assertLessEqual(len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()), 1500)


class MediaPipelineTests(AsyncStoreCase):
    async def test_failed_upload_reuses_extracted_payload(self):
        root = Path(self.temp.name) / "downloads"
        root.mkdir()
        (root / "test.mkv").touch()
        sample = torrent(save_path=str(root))
        self.store.observe(Snapshot((sample,), {}, time.time()), media_enabled=True, managed_hashes={sample.hash})
        self.store.media_stage(sample.hash, "ready", time.time(), files=[{"name": "test.mkv", "size": 100}])
        extractions, calls = [], []

        async def extractor(path, config):
            extractions.append(path)
            return parse_tracks(MEDIA)

        def handler(request):
            calls.append(request)
            return httpx.Response(503 if len(calls) == 1 else 200, json={"ok": True})

        cfg = settings(
            download_root=str(root), mediainfo_enabled=True, anibt_api_token="test", mediainfo_io_pressure_limit=0
        )
        pipeline = MediaPipeline(cfg, self.store, transport=httpx.MockTransport(handler), extractor=extractor)
        self.addAsyncCleanup(pipeline.close)
        with self.assertRaises(RuntimeError):
            await pipeline.step()
        self.assertEqual(self.store.stats()["media"], {"upload": 1})
        with self.store.connection() as db:
            db.execute("UPDATE media SET next_attempt=0")
        await pipeline.step()
        self.assertEqual(len(extractions), 1)
        self.assertEqual(len(calls), 2)
        self.assertEqual(self.store.stats()["media"], {"done": 1})
        self.assertEqual(calls[1].headers["authorization"], "Bearer test")
        self.assertEqual(json.loads(calls[1].content)["infoHash"], sample.hash)

    async def test_cleanup_reserved_hash_is_not_extracted(self):
        sample = torrent()
        self.store.observe(Snapshot((sample,), {}, time.time()), media_enabled=True, managed_hashes={sample.hash})
        self.store.media_stage(sample.hash, "ready", time.time(), files=[])
        pipeline = MediaPipeline(settings(), self.store)
        self.addAsyncCleanup(pipeline.close)
        pipeline.blocked_hashes = {sample.hash}
        await pipeline.step()
        self.assertEqual(self.store.stats()["media"], {"ready": 1})
