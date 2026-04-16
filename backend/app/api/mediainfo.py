"""
MediaInfo API endpoints for manual trigger and status checking.
"""

from fastapi import APIRouter
from sqlalchemy import func

from ..database import SessionLocal
from ..models import MediaInfoRecord

router = APIRouter()


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
async def trigger_check():
    """Manually trigger MediaInfo check."""
    from ..services.mediainfo_processor import check_mediainfo

    try:
        check_mediainfo()
        return {"ok": True, "message": "MediaInfo check completed"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


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
