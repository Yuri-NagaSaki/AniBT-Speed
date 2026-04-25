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
    instance_id: int = 0  # 0 = auto (load balanced)
    include_filter: str = ""
    exclude_filter: str = ""
    refresh_interval: int = 5
    max_items_per_check: int = 5
    enabled: bool = True


class RSSUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    instance_id: Optional[int] = None
    include_filter: Optional[str] = None
    exclude_filter: Optional[str] = None
    refresh_interval: Optional[int] = None
    max_items_per_check: Optional[int] = None
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
            "include_filter": f.include_filter,
            "exclude_filter": f.exclude_filter,
            "refresh_interval": f.refresh_interval,
            "max_items_per_check": f.max_items_per_check,
            "enabled": f.enabled,
        }
        for f in feeds
    ]


@router.post("")
def create_feed(body: RSSCreate, db: Session = Depends(get_db)):
    if body.instance_id and body.instance_id > 0:
        inst = db.query(QBTInstance).get(body.instance_id)
        if not inst:
            raise HTTPException(status_code=404, detail="Instance not found")

    feed = RSSFeed(**body.model_dump())
    db.add(feed)
    db.commit()
    db.refresh(feed)

    # AniBT-Speed owns RSS downloads. Remove legacy qB native rules that could
    # add torrents without the configured instance tag.
    if feed.enabled and feed.instance_id and feed.instance_id > 0:
        try:
            _disable_qbt_native_rss_rule(db, feed)
        except Exception:
            pass

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

    if feed.enabled and feed.instance_id and feed.instance_id > 0:
        try:
            _disable_qbt_native_rss_rule(db, feed)
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


def _disable_qbt_native_rss_rule(db: Session, feed: RSSFeed):
    """Disable legacy qB RSS auto-download rules for this feed.

    The server-side poller adds torrents with the configured save path and tag.
    Letting qB's native RSS rule also auto-download can race with the poller and
    create untagged torrents.
    """
    inst = db.query(QBTInstance).get(feed.instance_id)
    if not inst:
        return

    client = get_qbt_client(inst.id, inst.url, inst.username, inst.password)
    client.remove_rss_rule(f"anibt-speed-{feed.id}")
