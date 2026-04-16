"""Storage space management & removal policies."""
import logging
import time
import shutil
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import QBTInstance, PolicySettings, ActionLog
from app.services.qbt_client import get_qbt_client
from app.services.telegram_notifier import send_notification

logger = logging.getLogger(__name__)

DEFAULT_SPACE_CONFIG = {
    "enabled": True,
    "threshold_percent": 85,
    "protect_hours": 8,
    "boundary_hours": 12,
    "max_torrent_size_gb": 0,  # 0 = no limit
    "max_deletions_per_run": 20,
    "check_path": "/root/AniBt",
    "check_interval_minutes": 5,
}


def get_space_config(db: Session) -> dict:
    row = db.query(PolicySettings).filter_by(category="space").first()
    if row:
        return {**DEFAULT_SPACE_CONFIG, **row.config}
    return DEFAULT_SPACE_CONFIG.copy()


def check_space():
    """Periodic task: check disk usage and clean up if needed."""
    db = SessionLocal()
    try:
        config = get_space_config(db)
        if not config["enabled"]:
            return

        check_path = config["check_path"]
        usage = shutil.disk_usage(check_path)
        used_percent = (usage.used / usage.total) * 100

        if used_percent < config["threshold_percent"]:
            return

        logger.info(f"Space usage {used_percent:.1f}% exceeds threshold {config['threshold_percent']}%, cleaning up...")

        send_notification(
            f"⚠️ <b>空间告警</b>\n"
            f"磁盘使用率: {used_percent:.1f}%\n"
            f"阈值: {config['threshold_percent']}%\n"
            f"开始清理..."
        )

        instances = db.query(QBTInstance).filter_by(enabled=True).all()
        for inst in instances:
            _cleanup_instance(db, inst, config)

    except Exception as e:
        logger.error(f"Space check error: {e}")
    finally:
        db.close()


def _cleanup_instance(db: Session, instance: QBTInstance, config: dict):
    """Clean up torrents from a single instance based on policy."""
    try:
        client = get_qbt_client(instance.id, instance.url, instance.username, instance.password)
        torrents = client.client.torrents.info()
        now = time.time()

        protect_seconds = config["protect_hours"] * 3600
        boundary_seconds = config["boundary_hours"] * 3600

        protected = []
        mid_range = []
        old_range = []

        for t in torrents:
            age = now - t.added_on
            if age < protect_seconds:
                protected.append(t)
            elif age < boundary_seconds:
                mid_range.append(t)
            else:
                old_range.append(t)

        # Mid-range: keep high ratio (sort ascending, delete low ratio first)
        mid_range.sort(key=lambda t: t.ratio)
        # Old-range: keep low ratio (sort descending, delete high ratio first)
        old_range.sort(key=lambda t: t.ratio, reverse=True)

        candidates = mid_range + old_range
        max_deletions = config.get("max_deletions_per_run", 20)
        deleted = 0

        for t in candidates:
            if deleted >= max_deletions:
                logger.warning(f"Reached max deletion limit ({max_deletions}) for {instance.name}, stopping cleanup")
                break

            usage = shutil.disk_usage(config["check_path"])
            if (usage.used / usage.total) * 100 < config["threshold_percent"]:
                break

            client.delete_torrent(t.hash)
            logger.info(f"Deleted torrent: {t.name} (ratio: {t.ratio:.2f}, age: {(now - t.added_on) / 3600:.1f}h)")

            db.add(ActionLog(
                action="delete",
                instance_id=instance.id,
                torrent_name=t.name,
                details=f"Space cleanup: ratio={t.ratio:.2f}, age={(now - t.added_on) / 3600:.1f}h",
            ))
            db.commit()

            deleted += 1
            send_notification(
                f"🗑 <b>空间清理</b>\n"
                f"实例: {instance.name}\n"
                f"删除: {t.name}\n"
                f"分享率: {t.ratio:.2f} · 年龄: {(now - t.added_on) / 3600:.1f}h"
            )

    except Exception as e:
        logger.error(f"Cleanup error for instance {instance.name}: {e}")
