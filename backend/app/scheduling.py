"""Non-overlapping, deadline-bounded periodic jobs with backoff and no catch-up queue."""

import asyncio
import logging
import time
from dataclasses import asdict, dataclass

log = logging.getLogger(__name__)


@dataclass
class JobState:
    running: bool = False
    runs: int = 0
    failures: int = 0
    consecutive_failures: int = 0
    last_started: float | None = None
    last_success: float | None = None
    last_duration_seconds: float = 0
    next_run: float | None = None
    error: str | None = None


class PeriodicJob:
    def __init__(self, name: str, function, interval: float, budget: float, max_backoff: float = 300):
        self.name, self.function = name, function
        self.interval, self.budget, self.max_backoff = interval, budget, max_backoff
        self.state = JobState()
        self._lock = asyncio.Lock()

    async def once(self):
        if self._lock.locked():
            return
        async with self._lock:
            state = self.state
            started = time.monotonic()
            state.running = True
            state.last_started = time.time()
            state.runs += 1
            try:
                async with asyncio.timeout(self.budget):
                    await self.function()
                state.last_success = time.time()
                state.consecutive_failures = 0
                state.error = None
            except asyncio.CancelledError:
                raise
            except Exception as error:
                state.failures += 1
                state.consecutive_failures += 1
                # HTTP adapters replace errors with endpoint/status-only messages.
                state.error = f"{type(error).__name__}: {error}"[:300]
                log.warning("Job deferred name=%s error=%s", self.name, state.error)
            finally:
                state.running = False
                state.last_duration_seconds = time.monotonic() - started

    async def run(self):
        while True:
            await self.once()
            if self.state.consecutive_failures:
                delay = min(self.max_backoff, self.interval * 2 ** min(self.state.consecutive_failures, 10))
            else:
                delay = max(1, self.interval - self.state.last_duration_seconds)
            self.state.next_run = time.time() + delay
            await asyncio.sleep(delay)

    def status(self) -> dict:
        return asdict(self.state)
