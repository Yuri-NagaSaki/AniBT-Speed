"""Rate limiting with sliding window traffic control."""
import logging
import time
from collections import deque
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import QBTInstance, PolicySettings, TrafficRecord
from app.services.qbt_client import get_qbt_client

logger = logging.getLogger(__name__)

DEFAULT_RATE_CONFIG = {
    "enabled": True,
    "seed_only_upload_kbps": 102400,     # 100 MB/s
    "active_dl_upload_kbps": 81920,       # 80 MB/s
    "active_dl_download_kbps": 61440,     # 60 MB/s
    "sliding_window_enabled": False,
    "hourly_limit_gb": 200,
    "daily_limit_gb": 2000,
}

# In-memory sliding window records
_hourly_window: deque = deque()
_daily_window: deque = deque()


def get_rate_config(db: Session) -> dict:
    row = db.query(PolicySettings).filter_by(category="rate_limit").first()
    if row:
        return {**DEFAULT_RATE_CONFIG, **row.config}
    return DEFAULT_RATE_CONFIG.copy()


def check_rate():
    """Periodic task: adjust speed limits based on current state."""
    db = SessionLocal()
    try:
        config = get_rate_config(db)
        if not config["enabled"]:
            return

        instances = db.query(QBTInstance).filter_by(enabled=True).all()
        for inst in instances:
            _adjust_rate(db, inst, config)
    except Exception as e:
        logger.error(f"Rate check error: {e}")
    finally:
        db.close()


def _adjust_rate(db: Session, instance: QBTInstance, config: dict):
    try:
        client = get_qbt_client(instance.id, instance.url, instance.username, instance.password)
        status = client.get_status()

        has_downloads = status["dl_speed"] > 10240  # > 10 KB/s means active download

        if config["sliding_window_enabled"]:
            if _check_window_exceeded(db, instance.id, config):
                client.set_speed_limits(dl_limit=1024, up_limit=1024)  # throttle to 1 KB/s
                logger.warning(f"Sliding window limit exceeded for {instance.name}, throttling")
                return

        if has_downloads:
            ul = config["active_dl_upload_kbps"] * 1024
            dl = config["active_dl_download_kbps"] * 1024
        else:
            ul = config["seed_only_upload_kbps"] * 1024
            dl = 0  # no download limit when only seeding

        client.set_speed_limits(dl_limit=dl, up_limit=ul)

        # Record traffic for sliding window
        db.add(TrafficRecord(
            instance_id=instance.id,
            uploaded=status["up_speed"] * 60,  # approximate bytes in last minute
            downloaded=status["dl_speed"] * 60,
        ))
        db.commit()

    except Exception as e:
        logger.error(f"Rate adjustment error for {instance.name}: {e}")


def _check_window_exceeded(db: Session, instance_id: int, config: dict) -> bool:
    """Check if sliding window limits are exceeded."""
    import datetime

    now = datetime.datetime.utcnow()
    hour_ago = now - datetime.timedelta(hours=1)
    day_ago = now - datetime.timedelta(hours=24)

    hourly_total = db.query(
        TrafficRecord
    ).filter(
        TrafficRecord.instance_id == instance_id,
        TrafficRecord.timestamp >= hour_ago,
    ).with_entities(
        TrafficRecord.uploaded
    ).all()

    hourly_bytes = sum(r.uploaded for r in hourly_total)
    hourly_gb = hourly_bytes / (1024 ** 3)

    if hourly_gb >= config["hourly_limit_gb"]:
        return True

    daily_total = db.query(
        TrafficRecord
    ).filter(
        TrafficRecord.instance_id == instance_id,
        TrafficRecord.timestamp >= day_ago,
    ).with_entities(
        TrafficRecord.uploaded
    ).all()

    daily_bytes = sum(r.uploaded for r in daily_total)
    daily_gb = daily_bytes / (1024 ** 3)

    return daily_gb >= config["daily_limit_gb"]
