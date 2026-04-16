from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import PolicySettings
from app.services.telegram_notifier import DEFAULT_TELEGRAM_CONFIG, test_send

router = APIRouter()


class TelegramConfig(BaseModel):
    bot_token: str = ""
    chat_id: str = ""
    enabled: bool = False
    notify_new_download: bool = True
    notify_completed: bool = True
    notify_deleted: bool = True
    notify_paused: bool = True
    notify_resumed: bool = True
    notify_space_alert: bool = True
    daily_summary: bool = True
    daily_summary_hour: int = 20


@router.get("")
def get_config(db: Session = Depends(get_db)):
    row = db.query(PolicySettings).filter_by(category="telegram").first()
    config = {**DEFAULT_TELEGRAM_CONFIG, **(row.config if row else {})}
    # Mask bot_token in API response to prevent leakage
    if config.get("bot_token"):
        token = config["bot_token"]
        config["bot_token"] = token[:8] + "***" + token[-4:] if len(token) > 12 else "***"
    return config


@router.put("")
def update_config(body: TelegramConfig, db: Session = Depends(get_db)):
    config_data = body.model_dump()
    row = db.query(PolicySettings).filter_by(category="telegram").first()
    # If bot_token looks masked (contains ***), preserve the existing token
    if "***" in config_data.get("bot_token", "") and row and row.config.get("bot_token"):
        config_data["bot_token"] = row.config["bot_token"]
    if row:
        row.config = config_data
    else:
        row = PolicySettings(category="telegram", config=config_data)
        db.add(row)
    db.commit()
    return {"ok": True}


@router.post("/test")
async def test_telegram(db: Session = Depends(get_db)):
    row = db.query(PolicySettings).filter_by(category="telegram").first()
    if not row or not row.config.get("bot_token") or not row.config.get("chat_id"):
        return {"success": False, "error": "Telegram not configured"}

    result = await test_send(row.config["bot_token"], row.config["chat_id"])
    return result
