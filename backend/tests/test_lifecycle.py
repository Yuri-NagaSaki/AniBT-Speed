import json
import os
from pathlib import Path

from pydantic import ValidationError

from app.config import Settings
from app.lifecycle import WorkerLease, write_status
from tests.support import StoreCase, settings


class LifecycleTests(StoreCase):
    def test_exclusive_lease_releases_on_shutdown(self):
        directory = Path(self.temp.name)
        with WorkerLease(directory):
            with self.assertRaises(RuntimeError):
                with WorkerLease(directory):
                    self.fail("second worker acquired lease")
        with WorkerLease(directory):
            pass

    def test_status_is_atomic_and_private(self):
        path = Path(self.temp.name) / "status.json"
        write_status(path, {"status": "ok"})
        self.assertEqual(json.loads(path.read_text()), {"status": "ok"})
        self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
        self.assertFalse(path.with_suffix(".tmp").exists())

    def test_removed_config_keys_are_rejected_and_secrets_hidden(self):
        with self.assertRaises(ValidationError):
            Settings(_env_file=None, qbt_username="admin")
        with self.assertRaises(ValidationError):
            settings(control_budget_seconds=100)
        with self.assertRaises(ValidationError):
            settings(download_root="/")
        cfg = settings()
        self.assertNotIn("test-key", repr(cfg))
        cfg.require_runtime()
