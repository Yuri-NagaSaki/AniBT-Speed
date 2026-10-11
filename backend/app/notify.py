"""Optional bounded notifications; delivery cannot hold the control loop."""

import asyncio

import httpx


class Notifier:
    def __init__(self, settings):
        self.settings = settings
        self.queue = asyncio.Queue(maxsize=100)
        self.dropped = 0
        self.http = httpx.AsyncClient(timeout=5, follow_redirects=False)

    def offer(self, message: str):
        try:
            self.queue.put_nowait(message[:3500])
        except asyncio.QueueFull:
            self.dropped += 1

    async def step(self):
        if self.queue.empty():
            return
        message = self.queue.get_nowait()
        try:
            async with asyncio.timeout(5):
                response = await self.http.post(
                    f"https://api.telegram.org/bot{self.settings.notify_token.get_secret_value()}/sendMessage",
                    json={"chat_id": self.settings.notify_chat_id, "text": message},
                )
            if response.status_code != 200:
                raise RuntimeError(f"Notification HTTP {response.status_code}")
        except httpx.HTTPError, TimeoutError:
            raise RuntimeError("Notification delivery unavailable") from None
        finally:
            self.queue.task_done()

    async def close(self):
        await self.http.aclose()
