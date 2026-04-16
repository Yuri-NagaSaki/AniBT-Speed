import datetime
from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, Text, JSON

from app.database import Base

SHANGHAI_TZ = datetime.timezone(datetime.timedelta(hours=8))


def _now_shanghai():
    return datetime.datetime.now(SHANGHAI_TZ).replace(tzinfo=None)


class QBTInstance(Base):
    __tablename__ = "instances"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    url = Column(String(500), nullable=False)
    username = Column(String(100), nullable=False)
    password = Column(String(200), nullable=False)
    download_path = Column(String(500), default="")
    tag = Column(String(100), default="")
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=_now_shanghai)
    updated_at = Column(DateTime, default=_now_shanghai, onupdate=_now_shanghai)


class RSSFeed(Base):
    __tablename__ = "rss_feeds"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    url = Column(String(1000), nullable=False)
    instance_id = Column(Integer, nullable=False)
    include_filter = Column(String(1000), default="")
    exclude_filter = Column(String(1000), default="")
    refresh_interval = Column(Integer, default=5)  # minutes
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=_now_shanghai)


class PolicySettings(Base):
    __tablename__ = "policy_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    category = Column(String(50), nullable=False, unique=True)  # space, queue, rate_limit, telegram
    config = Column(JSON, nullable=False, default=dict)
    updated_at = Column(DateTime, default=_now_shanghai, onupdate=_now_shanghai)


class ActionLog(Base):
    __tablename__ = "action_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=_now_shanghai)
    action = Column(String(50), nullable=False)  # add, delete, pause, resume, ban, alert
    instance_id = Column(Integer, nullable=True)
    torrent_name = Column(String(500), default="")
    details = Column(Text, default="")


class TrafficRecord(Base):
    __tablename__ = "traffic_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=_now_shanghai)
    instance_id = Column(Integer, nullable=False)
    uploaded = Column(Float, default=0)  # bytes
    downloaded = Column(Float, default=0)  # bytes
    interval_seconds = Column(Integer, default=60)


class RSSProcessedItem(Base):
    __tablename__ = "rss_processed_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    feed_id = Column(Integer, nullable=False)
    guid = Column(String(1000), nullable=False)
    title = Column(String(500), default="")
    link = Column(String(2000), default="")
    instance_id = Column(Integer, nullable=True)
    added_at = Column(DateTime, default=_now_shanghai)


class MediaInfoRecord(Base):
    __tablename__ = "mediainfo_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    torrent_hash = Column(String, nullable=False, index=True, unique=True)
    release_id = Column(String, nullable=True)
    instance_id = Column(Integer, nullable=True)
    file_path = Column(String, nullable=True)
    mediainfo_json = Column(Text, nullable=True)
    sent_to_citrus = Column(Boolean, default=False, nullable=False)
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime, default=_now_shanghai, nullable=False)
    updated_at = Column(DateTime, default=_now_shanghai, onupdate=_now_shanghai, nullable=True)
