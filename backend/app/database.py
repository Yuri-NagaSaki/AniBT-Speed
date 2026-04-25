from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

from app.config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},
    echo=False,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    import logging
    logger = logging.getLogger(__name__)
    from app import models  # noqa: F401 - register SQLAlchemy models before create_all

    Base.metadata.create_all(bind=engine)

    # Migrate additive columns for existing deployments.
    import sqlite3
    db_path = engine.url.database
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.execute("PRAGMA table_info(instances)")
        columns = [row[1] for row in cursor.fetchall()]
        if "tag" not in columns:
            conn.execute("ALTER TABLE instances ADD COLUMN tag VARCHAR(100) DEFAULT ''")
            conn.commit()
            logger.info("Database migration: added 'tag' column to instances")

        cursor = conn.execute("PRAGMA table_info(rss_feeds)")
        rss_columns = [row[1] for row in cursor.fetchall()]
        if "max_items_per_check" not in rss_columns:
            conn.execute("ALTER TABLE rss_feeds ADD COLUMN max_items_per_check INTEGER DEFAULT 5")
            conn.commit()
            logger.info("Database migration: added 'max_items_per_check' column to rss_feeds")
        conn.close()
    except Exception as e:
        logger.error(f"Database migration error: {e}")
        raise
