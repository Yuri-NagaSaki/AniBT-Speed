"""Telegram notification module."""
import logging
import asyncio
from telegram import Bot
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import PolicySettings

logger = logging.getLogger(__name__)

DEFAULT_TELEGRAM_CONFIG = {
    "enabled": False,
    "bot_token": "",
    "chat_id": "",
    "notify_new_download": True,
    "notify_completed": True,
    "notify_deleted": True,
    "notify_paused": True,
    "notify_resumed": True,
    "notify_space_alert": True,
    "daily_summary": True,
    "daily_summary_hour": 20,
}


def get_telegram_config(db: Session = None) -> dict:
    if db is None:
        db = SessionLocal()
        should_close = True
    else:
        should_close = False

    try:
        row = db.query(PolicySettings).filter_by(category="telegram").first()
        if row:
            return {**DEFAULT_TELEGRAM_CONFIG, **row.config}
        return DEFAULT_TELEGRAM_CONFIG.copy()
    finally:
        if should_close:
            db.close()


def send_notification(message: str, parse_mode: str = "HTML"):
    """Send a Telegram notification (fire-and-forget)."""
    config = get_telegram_config()
    if not config["enabled"] or not config["bot_token"] or not config["chat_id"]:
        return

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(_send(config["bot_token"], config["chat_id"], message, parse_mode))
        loop.close()
    except Exception as e:
        logger.error(f"Telegram send error: {e}")


async def _send(token: str, chat_id: str, message: str, parse_mode: str):
    bot = Bot(token=token)
    await bot.send_message(chat_id=chat_id, text=message, parse_mode=parse_mode)


async def test_send(token: str, chat_id: str) -> dict:
    """Send a test message. Returns success/error."""
    try:
        bot = Bot(token=token)
        await bot.send_message(
            chat_id=chat_id,
            text="✅ <b>AniBT-Speed</b> 连接测试成功！",
            parse_mode="HTML",
        )
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}
