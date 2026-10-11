"""Single-process ownership and atomic local status, without listening sockets."""

import fcntl
import json
import os
from pathlib import Path


class WorkerLease:
    def __init__(self, directory: Path):
        self.path = directory / "worker.lock"
        self.handle = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("a+")
        try:
            fcntl.flock(self.handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.handle.close()
            raise RuntimeError("Another AniBT worker owns STATE_DIR") from None
        return self

    def __exit__(self, *_):
        self.handle.close()


def write_status(path: Path, status: dict):
    temporary = path.with_suffix(".tmp")
    with temporary.open("w") as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(status, stream, ensure_ascii=False, separators=(",", ":"))
    temporary.replace(path)
