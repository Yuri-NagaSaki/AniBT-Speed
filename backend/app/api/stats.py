import datetime
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models import ActionLog, TrafficRecord

router = APIRouter()


@router.get("/logs")
def get_logs(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    action: str = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(ActionLog).order_by(ActionLog.timestamp.desc())
    if action:
        query = query.filter(ActionLog.action == action)
    total = query.count()
    logs = query.offset(offset).limit(limit).all()
    return {
        "total": total,
        "logs": [
            {
                "id": log.id,
                "timestamp": log.timestamp.isoformat() if log.timestamp else None,
                "action": log.action,
                "instance_id": log.instance_id,
                "torrent_name": log.torrent_name,
                "details": log.details,
            }
            for log in logs
        ],
    }


@router.get("/traffic")
def get_traffic(
    instance_id: int = Query(None),
    hours: int = Query(24, ge=1, le=168),
    db: Session = Depends(get_db),
):
    since = datetime.datetime.utcnow() - datetime.timedelta(hours=hours)
    query = db.query(TrafficRecord).filter(TrafficRecord.timestamp >= since)
    if instance_id:
        query = query.filter(TrafficRecord.instance_id == instance_id)

    records = query.order_by(TrafficRecord.timestamp.asc()).all()
    return [
        {
            "timestamp": r.timestamp.isoformat(),
            "instance_id": r.instance_id,
            "uploaded": r.uploaded,
            "downloaded": r.downloaded,
        }
        for r in records
    ]


@router.get("/summary")
def get_summary(db: Session = Depends(get_db)):
    now = datetime.datetime.utcnow()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    today_upload = db.query(func.sum(TrafficRecord.uploaded)).filter(
        TrafficRecord.timestamp >= today
    ).scalar() or 0

    today_download = db.query(func.sum(TrafficRecord.downloaded)).filter(
        TrafficRecord.timestamp >= today
    ).scalar() or 0

    total_logs = db.query(ActionLog).filter(ActionLog.timestamp >= today).count()

    return {
        "today_uploaded_bytes": today_upload,
        "today_downloaded_bytes": today_download,
        "today_actions": total_logs,
    }
