from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import RSSFeed, QBTInstance
from app.services.qbt_client import get_qbt_client

router = APIRouter()


class RSSCreate(BaseModel):
    name: str
    url: str
    instance_id: int
    download_path: str = ""
    tag: str = ""
    include_filter: str = ""
    exclude_filter: str = ""
    refresh_interval: int = 5
    enabled: bool = True


class RSSUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    instance_id: Optional[int] = None
    download_path: Optional[str] = None
    tag: Optional[str] = None
    include_filter: Optional[str] = None
    exclude_filter: Optional[str] = None
    refresh_interval: Optional[int] = None
    enabled: Optional[bool] = None


@router.get("")
def list_feeds(db: Session = Depends(get_db)):
    feeds = db.query(RSSFeed).all()
    return [
        {
            "id": f.id,
            "name": f.name,
            "url": f.url,
            "instance_id": f.instance_id,
            "download_path": f.download_path,
            "tag": f.tag or "",
            "include_filter": f.include_filter,
            "exclude_filter": f.exclude_filter,
            "refresh_interval": f.refresh_interval,
            "enabled": f.enabled,
        }
        for f in feeds
    ]


@router.post("")
def create_feed(body: RSSCreate, db: Session = Depends(get_db)):
    inst = db.query(QBTInstance).get(body.instance_id)
    if not inst:
        raise HTTPException(status_code=404, detail="Instance not found")

    feed = RSSFeed(**body.model_dump())
    db.add(feed)
    db.commit()
    db.refresh(feed)

    # Sync to qBittorrent
    if feed.enabled:
        try:
            _sync_rss_to_qbt(db, feed)
        except Exception as e:
            pass  # non-fatal, logged

    return {"id": feed.id, "name": feed.name}


@router.put("/{feed_id}")
def update_feed(feed_id: int, body: RSSUpdate, db: Session = Depends(get_db)):
    feed = db.query(RSSFeed).get(feed_id)
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(feed, key, value)
    db.commit()

    if feed.enabled:
        try:
            _sync_rss_to_qbt(db, feed)
        except Exception:
            pass

    return {"ok": True}


@router.delete("/{feed_id}")
def delete_feed(feed_id: int, db: Session = Depends(get_db)):
    feed = db.query(RSSFeed).get(feed_id)
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")

    # Remove from qBittorrent
    try:
        inst = db.query(QBTInstance).get(feed.instance_id)
        if inst:
            client = get_qbt_client(inst.id, inst.url, inst.username, inst.password)
            client.remove_rss_feed(feed.name)
            client.remove_rss_rule(f"anibt-speed-{feed.id}")
    except Exception:
        pass

    db.delete(feed)
    db.commit()
    return {"ok": True}


def _sync_rss_to_qbt(db: Session, feed: RSSFeed):
    """Sync RSS feed + auto-download rule to qBittorrent."""
    inst = db.query(QBTInstance).get(feed.instance_id)
    if not inst:
        return

    client = get_qbt_client(inst.id, inst.url, inst.username, inst.password)

    # Add/update feed
    try:
        client.add_rss_feed(url=feed.url, path=feed.name)
    except Exception:
        pass  # may already exist

    # Set auto-download rule
    # Ensure tag exists in qBT if configured
    if feed.tag:
        try:
            client.create_tags([feed.tag])
        except Exception:
            pass

    rule = {
        "enabled": feed.enabled,
        "mustContain": feed.include_filter,
        "mustNotContain": feed.exclude_filter,
        "savePath": feed.download_path or inst.download_path,
        "affectedFeeds": [feed.url],
    }
    client.set_rss_rule(rule_name=f"anibt-speed-{feed.id}", rule_def=rule)
