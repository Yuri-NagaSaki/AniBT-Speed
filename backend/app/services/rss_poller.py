"""RSS poller — server-side RSS polling with load-balanced instance selection."""
import re
import logging
import feedparser
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import QBTInstance, RSSFeed, RSSProcessedItem, ActionLog
from app.services.qbt_client import get_qbt_client
from app.services.load_balancer import select_best_instance
from app.services.telegram_notifier import send_notification

logger = logging.getLogger(__name__)


def poll_rss_feeds():
    """Periodic task: poll all enabled RSS feeds and add new torrents."""
    db = SessionLocal()
    try:
        feeds = db.query(RSSFeed).filter_by(enabled=True).all()
        for feed in feeds:
            try:
                _poll_single_feed(db, feed)
            except Exception as e:
                logger.error(f"RSS poll error for '{feed.name}': {e}")
    except Exception as e:
        logger.error(f"RSS poller error: {e}")
    finally:
        db.close()


def _poll_single_feed(db: Session, feed: RSSFeed):
    """Poll a single RSS feed and add new items."""
    parsed = feedparser.parse(feed.url)
    if parsed.bozo and not parsed.entries:
        logger.warning(f"Failed to parse RSS feed '{feed.name}': {parsed.bozo_exception}")
        return

    for entry in parsed.entries:
        guid = entry.get("id") or entry.get("link") or entry.get("title", "")
        if not guid:
            continue

        # Check if already processed
        existing = db.query(RSSProcessedItem).filter_by(
            feed_id=feed.id, guid=guid
        ).first()
        if existing:
            continue

        title = entry.get("title", "")
        link = _extract_torrent_link(entry)
        if not link:
            continue

        # Apply include/exclude filters
        if not _matches_filters(title, feed.include_filter, feed.exclude_filter):
            # Mark as processed even if filtered out to avoid re-checking
            db.add(RSSProcessedItem(feed_id=feed.id, guid=guid, title=title, link=link))
            db.commit()
            continue

        # Select target instance
        if feed.instance_id and feed.instance_id > 0:
            inst = db.query(QBTInstance).get(feed.instance_id)
        else:
            inst = select_best_instance(db)

        if not inst:
            logger.warning(f"No available instance for RSS item: {title}")
            continue

        # Add torrent to selected instance
        try:
            client = get_qbt_client(inst.id, inst.url, inst.username, inst.password)
            save_path = feed.download_path or inst.download_path or ""

            # Ensure tag exists
            if feed.tag:
                try:
                    client.create_tags([feed.tag])
                except Exception:
                    pass

            client.add_torrent_url(url=link, save_path=save_path, tags=feed.tag or "")

            # Record as processed
            db.add(RSSProcessedItem(
                feed_id=feed.id, guid=guid, title=title,
                link=link, instance_id=inst.id,
            ))
            db.add(ActionLog(
                action="add",
                instance_id=inst.id,
                torrent_name=title,
                details=f"RSS: {feed.name}",
            ))
            db.commit()

            logger.info(f"Added '{title}' to instance '{inst.name}' from RSS '{feed.name}'")
            send_notification(
                f"<b>新种子</b>\n"
                f"RSS: {feed.name}\n"
                f"种子: {title}\n"
                f"实例: {inst.name}"
            )

        except Exception as e:
            logger.error(f"Failed to add torrent '{title}' to {inst.name}: {e}")


def _extract_torrent_link(entry: dict) -> str:
    """Extract magnet link or torrent URL from an RSS entry."""
    # Check for magnet link in various fields
    for field in ("link", "href"):
        val = entry.get(field, "")
        if val and val.startswith("magnet:"):
            return val

    # Check enclosures
    for enc in entry.get("enclosures", []):
        href = enc.get("href", "")
        if href and (href.endswith(".torrent") or href.startswith("magnet:")):
            return href

    # Check links list
    for link in entry.get("links", []):
        href = link.get("href", "")
        if href and (href.endswith(".torrent") or href.startswith("magnet:")):
            return href

    # Fallback to entry link
    link = entry.get("link", "")
    if link and (link.endswith(".torrent") or link.startswith("magnet:")):
        return link

    return ""


def _matches_filters(title: str, include: str, exclude: str) -> bool:
    """Check if a title matches include/exclude filter patterns.

    Filters use | as separator for multiple terms.
    Empty filter = match all.
    """
    if include:
        terms = [t.strip() for t in include.split("|") if t.strip()]
        if terms and not any(re.search(t, title, re.IGNORECASE) for t in terms):
            return False

    if exclude:
        terms = [t.strip() for t in exclude.split("|") if t.strip()]
        if terms and any(re.search(t, title, re.IGNORECASE) for t in terms):
            return False

    return True
