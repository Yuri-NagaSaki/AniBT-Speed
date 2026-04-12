import datetime
from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, Text, JSON

from app.database import Base


class QBTInstance(Base):
    __tablename__ = "instances"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    url = Column(String(500), nullable=False)
    username = Column(String(100), nullable=False)
    password = Column(String(200), nullable=False)
    download_path = Column(String(500), default="")
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class RSSFeed(Base):
    __tablename__ = "rss_feeds"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    url = Column(String(1000), nullable=False)
    instance_id = Column(Integer, nullable=False)
    download_path = Column(String(500), default="")
    include_filter = Column(String(1000), default="")
    exclude_filter = Column(String(1000), default="")
    refresh_interval = Column(Integer, default=5)  # minutes
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class PolicySettings(Base):
    __tablename__ = "policy_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    category = Column(String(50), nullable=False, unique=True)  # space, queue, rate_limit, telegram
    config = Column(JSON, nullable=False, default=dict)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class ActionLog(Base):
    __tablename__ = "action_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    action = Column(String(50), nullable=False)  # add, delete, pause, resume, ban, alert
    instance_id = Column(Integer, nullable=True)
    torrent_name = Column(String(500), default="")
    details = Column(Text, default="")


class TrafficRecord(Base):
    __tablename__ = "traffic_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    instance_id = Column(Integer, nullable=False)
    uploaded = Column(Float, default=0)  # bytes
    downloaded = Column(Float, default=0)  # bytes
    interval_seconds = Column(Integer, default=60)
