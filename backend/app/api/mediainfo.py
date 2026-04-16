"""
MediaInfo API endpoints for status checking.
MediaInfo is pushed by standalone agents running on qBT servers.
"""

import logging

from fastapi import APIRouter
from sqlalchemy import func

from ..database import SessionLocal
from ..models import MediaInfoRecord

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/status")
async def get_status():
    """Get MediaInfo processing status summary."""
    db = SessionLocal()
    try:
        total = db.query(func.count(MediaInfoRecord.id)).scalar() or 0
        sent = db.query(func.count(MediaInfoRecord.id)).filter(
            MediaInfoRecord.sent_to_citrus == True
        ).scalar() or 0
        errors = db.query(func.count(MediaInfoRecord.id)).filter(
            MediaInfoRecord.error_message.isnot(None),
            MediaInfoRecord.sent_to_citrus == False,
        ).scalar() or 0
        pending = total - sent - errors

        return {
            "total": total,
            "sent_to_citrus": sent,
            "errors": errors,
            "pending": pending,
        }
    finally:
        db.close()


@router.post("/trigger")
async def trigger_sync():
    """Trigger a MediaInfo scan: check all qBT instances for new completed torrents."""
    from ..services.mediainfo_processor import check_mediainfo

    try:
        check_mediainfo()
    except Exception as e:
        logger.error(f"MediaInfo trigger failed: {e}")
        return {"ok": False, "message": f"扫描失败: {str(e)}"}

    db = SessionLocal()
    try:
        total = db.query(func.count(MediaInfoRecord.id)).scalar() or 0
        sent = db.query(func.count(MediaInfoRecord.id)).filter(
            MediaInfoRecord.sent_to_citrus == True
        ).scalar() or 0
        return {"ok": True, "message": f"扫描完成，共 {total} 条记录，已推送 {sent} 条"}
    finally:
        db.close()


@router.get("/records")
async def list_records(limit: int = 50, offset: int = 0):
    """List recent MediaInfo records."""
    db = SessionLocal()
    try:
        records = db.query(MediaInfoRecord).order_by(
            MediaInfoRecord.created_at.desc()
        ).offset(offset).limit(limit).all()

        return [
            {
                "id": r.id,
                "torrent_hash": r.torrent_hash,
                "release_id": r.release_id,
                "file_path": r.file_path,
                "sent_to_citrus": r.sent_to_citrus,
                "error_message": r.error_message,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in records
        ]
    finally:
        db.close()
