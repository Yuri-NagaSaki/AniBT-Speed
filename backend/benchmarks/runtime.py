"""Read-only, alternating full-list/incremental benchmark against the configured qB."""

import argparse
import asyncio
import json
import statistics
import time
from pathlib import Path

from app.config import Settings
from app.qbt import QBTClient, QBTError


async def benchmark(samples: int, interval: float) -> dict:
    settings = Settings()
    settings.require_runtime()
    qbt = QBTClient(settings, read_only=True)
    report = {"full": [], "delta": [], "cold_sync": None, "errors": []}
    try:
        before = qbt.bytes_received
        started = time.monotonic()
        snapshot = await qbt.snapshot()
        report["cold_sync"] = {"seconds": time.monotonic() - started, "bytes": qbt.bytes_received - before}
        report["torrents"] = len(snapshot.torrents)
        for index in range(samples):
            await asyncio.sleep(interval)
            # Alternate order to avoid systematically benefiting one arm from warmed state.
            for arm in ("full", "delta") if index % 2 == 0 else ("delta", "full"):
                before = qbt.bytes_received
                started = time.monotonic()
                try:
                    if arm == "full":
                        json.loads(await qbt.request("GET", "torrents/info"))
                    else:
                        await qbt.snapshot()
                    report[arm].append({"seconds": time.monotonic() - started, "bytes": qbt.bytes_received - before})
                except QBTError as error:
                    report["errors"].append({"arm": arm, "error": str(error)})
                    return report  # Do not turn a diagnostic into a retry load.
        report["median"] = {
            arm: {key: statistics.median(sample[key] for sample in report[arm]) for key in ("bytes", "seconds")}
            for arm in ("full", "delta")
        }
        return report
    finally:
        await qbt.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--interval", type=float, default=1)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 1 <= args.samples <= 10 or args.interval < 0:
        parser.error("Use 1-10 samples and a nonnegative interval")
    result = asyncio.run(benchmark(args.samples, args.interval))
    rendered = json.dumps(result, indent=2)
    if args.output:
        args.output.write_text(rendered)
    print(rendered)
