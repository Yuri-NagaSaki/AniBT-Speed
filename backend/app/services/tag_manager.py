"""Tag manager — automatically apply tags to torrents based on RSS feed config."""
import logging
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import QBTInstance, RSSFeed
from app.services.qbt_client import get_qbt_client

logger = logging.getLogger(__name__)


def check_tags():
    """Periodic task: ensure torrents from RSS feeds have their configured tags."""
    db = SessionLocal()
    try:
        feeds = db.query(RSSFeed).filter(RSSFeed.tag != "", RSSFeed.enabled == True).all()
        if not feeds:
            return

        # Group feeds by instance
        instance_feeds: dict[int, list[RSSFeed]] = {}
        for feed in feeds:
            instance_feeds.setdefault(feed.instance_id, []).append(feed)

        for inst_id, inst_feeds in instance_feeds.items():
            inst = db.query(QBTInstance).get(inst_id)
            if not inst or not inst.enabled:
                continue
            _apply_tags_for_instance(inst, inst_feeds)
    except Exception as e:
        logger.error(f"Tag check error: {e}")
    finally:
        db.close()


def _apply_tags_for_instance(instance: QBTInstance, feeds: list[RSSFeed]):
    """Apply tags to torrents that match RSS feed save paths."""
    try:
        client = get_qbt_client(instance.id, instance.url, instance.username, instance.password)
        torrents = client.client.torrents.info()

        # Ensure all tags exist
        tags_to_create = list({f.tag for f in feeds if f.tag})
        if tags_to_create:
            try:
                client.create_tags(tags_to_create)
            except Exception:
                pass

        # Build save_path -> tag mapping
        path_tag_map: dict[str, str] = {}
        for feed in feeds:
            save_path = feed.download_path or ""
            if save_path and feed.tag:
                path_tag_map[save_path] = feed.tag

        for t in torrents:
            existing_tags = set(t.tags.split(",")) if t.tags else set()

            for save_path, tag in path_tag_map.items():
                torrent_path = getattr(t, "save_path", "") or getattr(t, "content_path", "") or ""
                if torrent_path.rstrip("/").startswith(save_path.rstrip("/")):
                    if tag not in existing_tags:
                        client.add_tags_to_torrents(t.hash, tag)
                        logger.info(f"Tagged '{t.name}' with '{tag}'")
                        break

    except Exception as e:
        logger.error(f"Tag management error for {instance.name}: {e}")
