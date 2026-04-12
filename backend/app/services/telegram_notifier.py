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


def send_daily_summary():
    """Send daily statistics summary via Telegram."""
    config = get_telegram_config()
    if not config["enabled"] or not config["daily_summary"]:
        return

    db = SessionLocal()
    try:
        import datetime
        from app.models import QBTInstance, TrafficRecord, ActionLog
        from app.services.qbt_client import get_qbt_client

        shanghai_tz = datetime.timezone(datetime.timedelta(hours=8))
        today_start = datetime.datetime.now(shanghai_tz).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(datetime.timezone.utc).replace(tzinfo=None)

        # Traffic totals
        records = db.query(TrafficRecord).filter(TrafficRecord.timestamp >= today_start).all()
        total_up = sum(r.uploaded for r in records)
        total_dl = sum(r.downloaded for r in records)

        # Action counts
        actions = db.query(ActionLog).filter(ActionLog.timestamp >= today_start).all()
        delete_count = sum(1 for a in actions if a.action == "delete")
        pause_count = sum(1 for a in actions if a.action == "pause")
        resume_count = sum(1 for a in actions if a.action == "resume")

        # Instance stats
        instances = db.query(QBTInstance).filter_by(enabled=True).all()
        total_torrents = 0
        for inst in instances:
            try:
                client = get_qbt_client(inst.id, inst.url, inst.username, inst.password)
                info = client.client.torrents.info()
                total_torrents += len(info)
            except Exception:
                pass

        def fmt(b):
            if b >= 1024**4:
                return f"{b / 1024**4:.2f} TB"
            elif b >= 1024**3:
                return f"{b / 1024**3:.2f} GB"
            elif b >= 1024**2:
                return f"{b / 1024**2:.1f} MB"
            return f"{b / 1024:.0f} KB"

        msg = (
            f"📊 <b>每日统计摘要</b>\n\n"
            f"📤 今日上传: <b>{fmt(total_up)}</b>\n"
            f"📥 今日下载: <b>{fmt(total_dl)}</b>\n"
            f"🌱 种子总数: <b>{total_torrents}</b>\n"
            f"🗑 删除: {delete_count} · ⏸ 暂停: {pause_count} · ▶️ 恢复: {resume_count}\n"
            f"📡 在线实例: {len(instances)}"
        )
        send_notification(msg)
    except Exception as e:
        logger.error(f"Daily summary error: {e}")
    finally:
        db.close()


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
