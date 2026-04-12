"""Load balancer — select the best qBT instance for new torrents."""
import logging
from typing import Optional
from sqlalchemy.orm import Session

from app.models import QBTInstance
from app.services.qbt_client import get_qbt_client

logger = logging.getLogger(__name__)


def select_best_instance(db: Session, exclude_ids: Optional[set[int]] = None) -> Optional[QBTInstance]:
    """Select the least-loaded qBT instance.

    Scoring (lower = better candidate):
    - Active torrent count (weight 1.0)
    - Upload speed in MB/s (weight 0.3)
    - Paused torrent count (weight 0.2)

    Falls back to the first available instance on error.
    """
    instances = db.query(QBTInstance).filter_by(enabled=True).all()
    if exclude_ids:
        instances = [i for i in instances if i.id not in exclude_ids]

    if not instances:
        return None
    if len(instances) == 1:
        return instances[0]

    best: Optional[QBTInstance] = None
    best_score = float("inf")

    for inst in instances:
        try:
            client = get_qbt_client(inst.id, inst.url, inst.username, inst.password)
            status = client.get_status()
            counts = client.get_torrent_count()

            score = (
                counts["active"] * 1.0
                + (status["up_speed"] / (1024 * 1024)) * 0.3
                + counts["paused"] * 0.2
            )

            if score < best_score:
                best_score = score
                best = inst
        except Exception as e:
            logger.warning(f"Cannot query instance {inst.name}: {e}")
            continue

    return best or instances[0]
