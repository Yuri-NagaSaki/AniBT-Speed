from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import PolicySettings
from app.services.space_manager import DEFAULT_SPACE_CONFIG
from app.services.queue_manager import DEFAULT_QUEUE_CONFIG
from app.services.rate_limiter import DEFAULT_RATE_CONFIG
from app.services.telegram_notifier import DEFAULT_TELEGRAM_CONFIG

router = APIRouter()

DEFAULTS = {
    "space": DEFAULT_SPACE_CONFIG,
    "queue": DEFAULT_QUEUE_CONFIG,
    "rate_limit": DEFAULT_RATE_CONFIG,
    "telegram": DEFAULT_TELEGRAM_CONFIG,
}


class SettingsUpdate(BaseModel):
    config: dict


@router.get("/{category}")
def get_settings(category: str, db: Session = Depends(get_db)):
    if category not in DEFAULTS:
        return {"error": f"Unknown category: {category}"}

    row = db.query(PolicySettings).filter_by(category=category).first()
    if row:
        return {**DEFAULTS[category], **row.config}
    return DEFAULTS[category]


@router.put("/{category}")
def update_settings(category: str, body: SettingsUpdate, db: Session = Depends(get_db)):
    if category not in DEFAULTS:
        return {"error": f"Unknown category: {category}"}

    row = db.query(PolicySettings).filter_by(category=category).first()
    if row:
        merged = {**row.config, **body.config}
        row.config = merged
    else:
        row = PolicySettings(category=category, config=body.config)
        db.add(row)

    db.commit()
    return {**DEFAULTS[category], **row.config}
