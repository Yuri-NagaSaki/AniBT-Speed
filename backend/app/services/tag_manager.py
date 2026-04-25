"""Tag manager — automatically apply tags to torrents based on instance config."""
import logging

from app.database import SessionLocal
from app.models import QBTInstance
from app.services.qbt_client import get_qbt_client

logger = logging.getLogger(__name__)


def check_tags():
    """Periodic task: ensure torrents on instances have their configured tags."""
    db = SessionLocal()
    try:
        instances = db.query(QBTInstance).filter(
            QBTInstance.tag != "", QBTInstance.enabled == True
        ).all()
        for inst in instances:
            _apply_tags_for_instance(inst)
    except Exception as e:
        logger.error(f"Tag check error: {e}")
    finally:
        db.close()


def _apply_tags_for_instance(instance: QBTInstance):
    """Apply the instance's tag to all its torrents that don't already have it."""
    tag = instance.tag
    if not tag:
        return
    try:
        client = get_qbt_client(instance.id, instance.url, instance.username, instance.password)

        try:
            client.create_tags([tag])
        except Exception:
            pass
        client.ensure_category(tag, instance.download_path or "")

        torrents = client.client.torrents.info()
        for t in torrents:
            existing_tags = {item.strip() for item in t.tags.split(",") if item.strip()} if t.tags else set()
            if tag not in existing_tags:
                client.add_tags_to_torrents(t.hash, tag)
                logger.info(f"Tagged '{t.name}' with '{tag}' on {instance.name}")
            if t.category != tag:
                client.set_torrent_category(t.hash, tag)
                logger.info(f"Categorized '{t.name}' as '{tag}' on {instance.name}")

    except Exception as e:
        logger.error(f"Tag management error for {instance.name}: {e}")
