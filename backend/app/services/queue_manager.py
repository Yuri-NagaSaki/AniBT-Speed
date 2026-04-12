"""Intelligent queue management — pause/resume based on peer activity."""
import logging
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import QBTInstance, PolicySettings, ActionLog
from app.services.qbt_client import get_qbt_client
from app.services.telegram_notifier import send_notification

logger = logging.getLogger(__name__)

DEFAULT_QUEUE_CONFIG = {
    "enabled": True,
    "pause_when_no_leechers": True,
    "resume_when_leechers_gt": 0,
    "min_seed_time_hours": 1,
    "exclude_tags": [],
}


def get_queue_config(db: Session) -> dict:
    row = db.query(PolicySettings).filter_by(category="queue").first()
    if row:
        return {**DEFAULT_QUEUE_CONFIG, **row.config}
    return DEFAULT_QUEUE_CONFIG.copy()


def check_queue():
    """Periodic task: manage queue based on peer status."""
    db = SessionLocal()
    try:
        config = get_queue_config(db)
        if not config["enabled"]:
            return

        instances = db.query(QBTInstance).filter_by(enabled=True).all()
        for inst in instances:
            _manage_queue(db, inst, config)
    except Exception as e:
        logger.error(f"Queue check error: {e}")
    finally:
        db.close()


def _manage_queue(db: Session, instance: QBTInstance, config: dict):
    """Pause torrents with no leechers, resume those with leechers."""
    import time

    try:
        client = get_qbt_client(instance.id, instance.url, instance.username, instance.password)
        torrents = client.client.torrents.info()
        now = time.time()
        min_seed = config["min_seed_time_hours"] * 3600
        exclude = set(config.get("exclude_tags", []))

        for t in torrents:
            tags = set(t.tags.split(",")) if t.tags else set()
            if tags & exclude:
                continue

            age = now - t.added_on
            if age < min_seed:
                continue

            is_seeding = t.state in ("uploading", "stalledUP")
            is_paused = t.state in ("pausedUP",)

            if is_seeding and config["pause_when_no_leechers"] and t.num_leechs == 0:
                client.pause_torrent(t.hash)
                logger.info(f"Paused (no leechers): {t.name}")
                db.add(ActionLog(
                    action="pause",
                    instance_id=instance.id,
                    torrent_name=t.name,
                    details="No leechers",
                ))
                send_notification(
                    f"⏸ <b>队列暂停</b>\n"
                    f"实例: {instance.name}\n"
                    f"种子: {t.name}\n"
                    f"原因: 无下载者"
                )

            elif is_paused and t.num_leechs > config["resume_when_leechers_gt"]:
                client.resume_torrent(t.hash)
                logger.info(f"Resumed (leechers={t.num_leechs}): {t.name}")
                db.add(ActionLog(
                    action="resume",
                    instance_id=instance.id,
                    torrent_name=t.name,
                    details=f"Leechers: {t.num_leechs}",
                ))
                send_notification(
                    f"▶️ <b>队列恢复</b>\n"
                    f"实例: {instance.name}\n"
                    f"种子: {t.name}\n"
                    f"下载者: {t.num_leechs}"
                )

        db.commit()
    except Exception as e:
        logger.error(f"Queue management error for {instance.name}: {e}")
