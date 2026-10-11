"""Run, inspect, or query local state. No HTTP server or listening port."""

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from dataclasses import asdict
from pathlib import Path

from pydantic import ValidationError

from app.config import Settings
from app.lifecycle import WorkerLease
from app.migrate import import_receipts
from app.qbt import QBTClient
from app.store import Store
from app.worker import Worker


async def inspect(settings: Settings, output: str | None):
    settings.require_runtime()
    client = QBTClient(settings, read_only=True)
    try:
        started = time.monotonic()
        snapshot = await client.snapshot()
        if output:
            with Path(output).open("w") as stream:
                os.fchmod(stream.fileno(), 0o600)
                json.dump(asdict(snapshot), stream, ensure_ascii=False, default=list)
        print(
            json.dumps(
                {
                    "torrents": len(snapshot.torrents),
                    "elapsed_seconds": round(time.monotonic() - started, 3),
                    "response_bytes": client.bytes_received,
                    "http_requests": sum(client.requests.values()),
                }
            )
        )
    finally:
        await client.close()


def main():
    parser = argparse.ArgumentParser(prog="anibt-speed")
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("run")
    status = commands.add_parser("status")
    status.add_argument(
        "--live", action="store_true", help="Check heartbeat only; dependency outages do not restart the worker"
    )
    inspection = commands.add_parser("inspect")
    inspection.add_argument("--output")
    migration = commands.add_parser("migrate")
    migration.add_argument("--rss-history", type=Path)
    migration.add_argument("--media-history", type=Path)
    args = parser.parse_args()
    try:
        settings = Settings()
        if args.command == "status":
            result = json.loads(settings.status_path.read_text())
            fresh = time.time() - result["updated_at"] <= 20
            healthy = fresh and result["status"] != "stopped" and (args.live or result["status"] == "ok")
            print(json.dumps({**result, "heartbeat_fresh": fresh}, ensure_ascii=False, indent=2))
            return 0 if healthy else 1
        if args.command == "inspect":
            asyncio.run(inspect(settings, args.output))
        elif args.command == "migrate":
            with WorkerLease(settings.state_dir):
                store = Store(settings.database_path)
                store.initialize()
                print(json.dumps(import_receipts(store, args.rss_history, args.media_history)))
        else:
            logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
            logging.getLogger("httpx").setLevel(logging.WARNING)
            asyncio.run(Worker(settings).run())
        return 0
    except ValidationError as error:
        print(
            "Invalid configuration: "
            + "; ".join(
                f"{'.'.join(map(str, item['loc']))}: {item['msg']}" for item in error.errors(include_input=False)
            ),
            file=sys.stderr,
        )
    except (OSError, ValueError, RuntimeError) as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
