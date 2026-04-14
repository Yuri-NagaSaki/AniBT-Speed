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
    Base.metadata.create_all(bind=engine)
    # Migrate: add 'tag' column to instances if missing
    import sqlite3
    db_path = engine.url.database
    conn = sqlite3.connect(db_path)
    cursor = conn.execute("PRAGMA table_info(instances)")
    columns = [row[1] for row in cursor.fetchall()]
    if "tag" not in columns:
        conn.execute("ALTER TABLE instances ADD COLUMN tag VARCHAR(100) DEFAULT ''")
        conn.commit()
    conn.close()
