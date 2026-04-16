from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import QBTInstance
from app.services.qbt_client import get_qbt_client, remove_qbt_client

router = APIRouter()


class InstanceCreate(BaseModel):
    name: str
    url: str
    username: str
    password: str
    download_path: str = ""
    tag: str = ""
    enabled: bool = True
    ssh_host: str = ""
    ssh_port: int = 22
    ssh_user: str = "root"
    ssh_key_path: str = ""
    path_mapping: Optional[dict] = None


class InstanceUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    download_path: Optional[str] = None
    tag: Optional[str] = None
    enabled: Optional[bool] = None
    ssh_host: Optional[str] = None
    ssh_port: Optional[int] = None
    ssh_user: Optional[str] = None
    ssh_key_path: Optional[str] = None
    path_mapping: Optional[dict] = None


@router.get("")
def list_instances(db: Session = Depends(get_db)):
    instances = db.query(QBTInstance).all()
    results = []
    for inst in instances:
        data = {
            "id": inst.id,
            "name": inst.name,
            "url": inst.url,
            "username": inst.username,
            "download_path": inst.download_path,
            "tag": inst.tag or "",
            "enabled": inst.enabled,
            "ssh_host": inst.ssh_host or "",
            "ssh_port": inst.ssh_port or 22,
            "ssh_user": inst.ssh_user or "root",
            "ssh_key_path": inst.ssh_key_path or "",
            "path_mapping": inst.path_mapping,
            "created_at": inst.created_at.isoformat() if inst.created_at else None,
        }
        if inst.enabled:
            try:
                client = get_qbt_client(inst.id, inst.url, inst.username, inst.password)
                status = client.get_status()
                counts = client.get_torrent_count()
                data["status"] = {**status, **counts, "connected": True}
            except Exception:
                data["status"] = {"connected": False}
        else:
            data["status"] = {"connected": False}
        results.append(data)
    return results


@router.post("")
def create_instance(body: InstanceCreate, db: Session = Depends(get_db)):
    inst = QBTInstance(**body.model_dump())
    db.add(inst)
    db.commit()
    db.refresh(inst)
    return {"id": inst.id, "name": inst.name}


@router.get("/{instance_id}")
def get_instance(instance_id: int, db: Session = Depends(get_db)):
    inst = db.query(QBTInstance).get(instance_id)
    if not inst:
        raise HTTPException(status_code=404, detail="Instance not found")
    return {
        "id": inst.id,
        "name": inst.name,
        "url": inst.url,
        "username": inst.username,
        "download_path": inst.download_path,
        "tag": inst.tag or "",
        "enabled": inst.enabled,
    }


@router.put("/{instance_id}")
def update_instance(instance_id: int, body: InstanceUpdate, db: Session = Depends(get_db)):
    inst = db.query(QBTInstance).get(instance_id)
    if not inst:
        raise HTTPException(status_code=404, detail="Instance not found")

    update_data = body.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(inst, key, value)

    db.commit()
    remove_qbt_client(instance_id)
    return {"ok": True}


@router.delete("/{instance_id}")
def delete_instance(instance_id: int, db: Session = Depends(get_db)):
    inst = db.query(QBTInstance).get(instance_id)
    if not inst:
        raise HTTPException(status_code=404, detail="Instance not found")
    db.delete(inst)
    db.commit()
    remove_qbt_client(instance_id)
    return {"ok": True}


class ConnectionTest(BaseModel):
    url: str
    username: str
    password: str


@router.post("/test-connection")
def test_connection(body: ConnectionTest):
    """Test connection to a qBittorrent instance without saving it."""
    from app.services.qbt_client import QBTClient
    client = QBTClient(body.url, body.username, body.password)
    return client.test_connection()


@router.post("/{instance_id}/test")
def test_instance(instance_id: int, db: Session = Depends(get_db)):
    inst = db.query(QBTInstance).get(instance_id)
    if not inst:
        raise HTTPException(status_code=404, detail="Instance not found")

    client = get_qbt_client(inst.id, inst.url, inst.username, inst.password)
    result = client.test_connection()
    return result


@router.get("/{instance_id}/torrents")
def list_torrents(instance_id: int, db: Session = Depends(get_db)):
    inst = db.query(QBTInstance).get(instance_id)
    if not inst:
        raise HTTPException(status_code=404, detail="Instance not found")

    try:
        client = get_qbt_client(inst.id, inst.url, inst.username, inst.password)
        torrents = client.client.torrents.info()
        return [
            {
                "hash": t.hash,
                "name": t.name,
                "size": t.size,
                "progress": t.progress,
                "state": t.state,
                "ratio": t.ratio,
                "up_speed": t.upspeed,
                "dl_speed": t.dlspeed,
                "num_seeds": t.num_seeds,
                "num_leechs": t.num_leechs,
                "added_on": t.added_on,
                "category": t.category,
                "tags": t.tags,
            }
            for t in torrents
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
