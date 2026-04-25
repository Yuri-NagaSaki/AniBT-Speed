"""Intelligent queue management — pause/resume based on peer activity."""
import logging
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import QBTInstance, PolicySettings, ActionLog
from app.services.qbt_client import PAUSED_SEEDING_STATES, SEEDING_STATES, get_qbt_client
from app.services.telegram_notifier import send_notification

logger = logging.getLogger(__name__)

DEFAULT_QUEUE_CONFIG = {
    "enabled": True,
    "pause_when_no_leechers": True,
    "resume_when_leechers_gt": 0,
    "min_seed_time_hours": 12,
    "exclude_tags": [],
    "probe_stopped_enabled": True,
    "probe_interval_minutes": 5,
    "probe_batch_size": 50,
    "probe_duration_minutes": 3,
    "keyword_cleanup_enabled": False,
    "keyword_cleanup_hours": 24,
    "keyword_cleanup_keywords": [],
    "keyword_cleanup_max_per_run": 20,
    "age_cleanup_enabled": False,
    "age_cleanup_months": 3,
    "age_cleanup_max_per_run": 20,
}

_probe_started_at: dict[str, float] = {}
_last_probe_batch_at = 0.0
_probe_cursor = 0


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
        exclude = {tag.strip() for tag in config.get("exclude_tags", []) if tag.strip()}
        cleanup_keywords = _normalize_keywords(config.get("keyword_cleanup_keywords", []))
        cleanup_after = config.get("keyword_cleanup_hours", 24) * 3600
        cleanup_enabled = config.get("keyword_cleanup_enabled", False) and cleanup_keywords
        cleanup_limit = config.get("keyword_cleanup_max_per_run", 20)
        cleanup_count = 0
        age_cleanup_enabled = config.get("age_cleanup_enabled", False)
        age_cleanup_after = max(int(config.get("age_cleanup_months", 3)), 1) * 30 * 24 * 3600
        age_cleanup_limit = max(int(config.get("age_cleanup_max_per_run", 20)), 1)
        age_cleanup_count = 0
        probing_hashes = _manage_probe_windows(client, torrents, config, now, min_seed, exclude)

        for t in torrents:
            tags = {tag.strip() for tag in t.tags.split(",") if tag.strip()} if t.tags else set()
            if tags & exclude:
                continue

            if cleanup_enabled and cleanup_count < cleanup_limit:
                matched_keyword = _match_keyword(t.name, cleanup_keywords)
                if matched_keyword:
                    seed_age = _seed_age_seconds(t, now)
                    if seed_age >= cleanup_after:
                        client.delete_torrent(t.hash)
                        logger.info(
                            f"Deleted by keyword cleanup: {t.name} "
                            f"(keyword: {matched_keyword}, seed age: {seed_age / 3600:.1f}h)"
                        )
                        db.add(ActionLog(
                            action="delete",
                            instance_id=instance.id,
                            torrent_name=t.name,
                            details=(
                                f"Keyword cleanup: keyword={matched_keyword}, "
                                f"seed_age={seed_age / 3600:.1f}h"
                            ),
                        ))
                        send_notification(
                            f"🗑 <b>关键词清理</b>\n"
                            f"实例: {instance.name}\n"
                            f"关键词: {matched_keyword}\n"
                            f"删除: {t.name}\n"
                            f"做种时长: {seed_age / 3600:.1f}h"
                        )
                        cleanup_count += 1
                        continue

            if age_cleanup_enabled and age_cleanup_count < age_cleanup_limit:
                seed_age = _seed_age_seconds(t, now)
                if seed_age >= age_cleanup_after:
                    client.delete_torrent(t.hash)
                    age_months = seed_age / (30 * 24 * 3600)
                    logger.info(f"Deleted by age cleanup: {t.name} (seed age: {age_months:.1f}mo)")
                    db.add(ActionLog(
                        action="delete",
                        instance_id=instance.id,
                        torrent_name=t.name,
                        details=f"Age cleanup: seed_age={age_months:.1f}mo",
                    ))
                    age_cleanup_count += 1
                    continue

            age = now - t.added_on
            if age < min_seed:
                continue

            is_seeding = t.state in SEEDING_STATES
            is_paused = t.state in PAUSED_SEEDING_STATES

            if t.hash in probing_hashes:
                continue

            if is_seeding and config["pause_when_no_leechers"] and t.num_leechs == 0:
                client.pause_torrent(t.hash)
                logger.info(f"Paused (no leechers): {t.name}")
                db.add(ActionLog(
                    action="pause",
                    instance_id=instance.id,
                    torrent_name=t.name,
                    details="No leechers",
                ))
                # Routine no-leecher pauses can happen in batches; keep them in logs
                # instead of sending many Telegram messages.

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


def _manage_probe_windows(client, torrents: list, config: dict, now: float, min_seed: float, exclude: set[str]) -> set[str]:
    """Rotate stopped seed torrents through short active windows to catch brief demand."""
    global _last_probe_batch_at, _probe_cursor

    torrent_by_hash = {t.hash: t for t in torrents}
    for torrent_hash in list(_probe_started_at):
        if torrent_hash not in torrent_by_hash:
            _probe_started_at.pop(torrent_hash, None)

    if not config.get("pause_when_no_leechers", True) or not config.get("probe_stopped_enabled", True):
        return set()

    threshold = config.get("resume_when_leechers_gt", 0)
    duration = max(int(config.get("probe_duration_minutes", 6)), 1) * 60
    interval = max(int(config.get("probe_interval_minutes", 15)), 1) * 60
    batch_size = max(int(config.get("probe_batch_size", 20)), 0)

    for torrent_hash, started_at in list(_probe_started_at.items()):
        if now - started_at < duration:
            continue

        torrent = torrent_by_hash.get(torrent_hash)
        _probe_started_at.pop(torrent_hash, None)
        if not torrent:
            continue

        has_demand = torrent.num_leechs > threshold or torrent.upspeed > 0
        if has_demand:
            logger.info(f"Kept probe active (leechers={torrent.num_leechs}): {torrent.name}")
        elif torrent.state in SEEDING_STATES:
            client.pause_torrent(torrent.hash)
            logger.info(f"Paused probe (no leechers): {torrent.name}")

    if batch_size <= 0 or now - _last_probe_batch_at < interval:
        return set(_probe_started_at)

    available_slots = batch_size - len(_probe_started_at)
    if available_slots <= 0:
        return set(_probe_started_at)

    candidates = []
    for torrent in torrents:
        if torrent.hash in _probe_started_at:
            continue
        if torrent.state not in PAUSED_SEEDING_STATES or getattr(torrent, "progress", 0) < 1:
            continue
        if now - torrent.added_on < min_seed:
            continue
        tags = {tag.strip() for tag in torrent.tags.split(",") if tag.strip()} if torrent.tags else set()
        if tags & exclude:
            continue
        candidates.append(torrent)

    if not candidates:
        return set(_probe_started_at)

    start = _probe_cursor % len(candidates)
    ordered = candidates[start:] + candidates[:start]
    selected = ordered[:available_slots]
    _probe_cursor = (start + len(selected)) % len(candidates)
    _last_probe_batch_at = now

    for torrent in selected:
        client.resume_torrent(torrent.hash)
        _probe_started_at[torrent.hash] = now
        logger.info(f"Started seed probe: {torrent.name}")

    return set(_probe_started_at)


def _normalize_keywords(value) -> list[str]:
    if isinstance(value, str):
        raw = value.split(",")
    elif isinstance(value, list):
        raw = value
    else:
        raw = []
    return [str(keyword).strip() for keyword in raw if str(keyword).strip()]


def _match_keyword(name: str, keywords: list[str]) -> str | None:
    lowered_name = name.lower()
    for keyword in keywords:
        if keyword.lower() in lowered_name:
            return keyword
    return None


def _seed_age_seconds(torrent, now: float) -> float:
    if getattr(torrent, "progress", 0) < 1:
        return -1
    completion_on = getattr(torrent, "completion_on", 0) or 0
    if completion_on > 0:
        return now - completion_on
    return now - torrent.added_on
