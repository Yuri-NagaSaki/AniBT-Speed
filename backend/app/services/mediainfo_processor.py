"""
MediaInfo Processor Service

Scans completed torrents across qBT instances, generates MediaInfo
via SSH on remote servers, and pushes structured data to Citrus API.
"""

import json
import logging
import os
import shlex
import subprocess
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from ..config import settings
from ..database import SessionLocal
from ..models import MediaInfoRecord, QBTInstance, RSSProcessedItem
from .qbt_client import get_qbt_client

logger = logging.getLogger(__name__)

VIDEO_EXTENSIONS = {".mkv", ".mp4", ".avi", ".wmv", ".flv", ".webm", ".ts", ".m2ts"}


def check_mediainfo():
    """Main entry point for the scheduled job."""
    logger.info("Starting MediaInfo check...")
    db = SessionLocal()
    try:
        _process_all_instances(db)
    except Exception as e:
        logger.error(f"MediaInfo check failed: {e}")
    finally:
        db.close()
    logger.info("MediaInfo check completed.")


def _process_all_instances(db: Session):
    """Process all qBT instances for completed torrents needing MediaInfo."""
    instances = db.query(QBTInstance).filter(QBTInstance.enabled == True).all()
    if not instances:
        logger.info("No active qBT instances found")
        return

    for instance in instances:
        if not instance.ssh_host:
            logger.debug(f"Skipping instance {instance.name}: no SSH config")
            continue
        try:
            _process_instance(db, instance)
        except Exception as e:
            logger.error(f"Error processing instance {instance.name} (ID={instance.id}): {e}")


def _process_instance(db: Session, instance: QBTInstance):
    """Process a single qBT instance."""
    client = get_qbt_client(instance.id, instance.url, instance.username, instance.password)
    if not client:
        logger.warning(f"Could not connect to qBT instance: {instance.name}")
        return

    try:
        torrents = client.get_torrents()
    except Exception as e:
        logger.error(f"Failed to get torrents from {instance.name}: {e}")
        return

    for torrent in torrents:
        if torrent.get("progress", 0) < 1.0:
            continue

        torrent_hash = torrent.get("hash", "").lower()
        if not torrent_hash:
            continue

        existing = db.query(MediaInfoRecord).filter(
            MediaInfoRecord.torrent_hash == torrent_hash
        ).first()
        if existing and existing.sent_to_citrus:
            continue

        try:
            _process_torrent(db, instance, torrent, torrent_hash, existing)
        except Exception as e:
            logger.error(f"Error processing torrent {torrent_hash}: {e}")
            _save_error(db, torrent_hash, instance.id, str(e), existing)


def _map_path(instance: QBTInstance, container_path: str) -> str:
    """Apply path mapping from container path to host path."""
    mapping = instance.path_mapping
    if not mapping:
        return container_path
    from_prefix = mapping.get("from", "")
    to_prefix = mapping.get("to", "")
    if from_prefix and container_path.startswith(from_prefix):
        return to_prefix + container_path[len(from_prefix):]
    return container_path


def _build_ssh_cmd(instance: QBTInstance, remote_cmd: str) -> list[str]:
    """Build SSH command with instance config."""
    cmd = [
        "ssh",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        "-o", "BatchMode=yes",
    ]
    if instance.ssh_key_path:
        cmd.extend(["-i", instance.ssh_key_path])
    if instance.ssh_port and instance.ssh_port != 22:
        cmd.extend(["-p", str(instance.ssh_port)])
    cmd.append(f"{instance.ssh_user or 'root'}@{instance.ssh_host}")
    cmd.append(remote_cmd)
    return cmd


def _process_torrent(
    db: Session,
    instance: QBTInstance,
    torrent: dict,
    torrent_hash: str,
    existing: Optional[MediaInfoRecord],
):
    """Process a single completed torrent."""
    release_id = _find_release_id(db, torrent)

    content_path = torrent.get("content_path", "")
    save_path = torrent.get("save_path", "")

    host_content = _map_path(instance, content_path) if content_path else ""
    host_save = _map_path(instance, save_path) if save_path else ""

    video_path = _find_video_file_ssh(instance, host_content, host_save)
    if not video_path:
        logger.debug(f"No video file found for torrent {torrent_hash}")
        return

    raw_json = _run_mediainfo_ssh(instance, video_path)
    if not raw_json:
        return

    structured = _parse_mediainfo(raw_json, video_path)
    if not structured:
        logger.warning(f"Failed to parse mediainfo output for {video_path}")
        return

    # Get HTML output for raw display
    raw_html = _run_mediainfo_html_ssh(instance, video_path)
    if raw_html:
        raw_html = _sanitize_raw_html(raw_html, os.path.basename(video_path))
        structured["rawText"] = raw_html

    record = existing or MediaInfoRecord(torrent_hash=torrent_hash)
    record.release_id = release_id
    record.instance_id = instance.id
    record.file_path = video_path
    record.mediainfo_json = raw_json
    record.sent_to_citrus = False
    record.error_message = None
    if not existing:
        db.add(record)
    db.commit()

    if release_id and settings.citrus_api_url and settings.citrus_mediainfo_token:
        success = _push_to_citrus(release_id, torrent_hash, structured)
        if success:
            record.sent_to_citrus = True
            record.error_message = None
            db.commit()
            logger.info(f"MediaInfo pushed to AniBT for release {release_id}")
        else:
            logger.warning(f"Failed to push MediaInfo to AniBT for release {release_id}")
    elif not release_id:
        logger.info(f"No releaseId found for torrent {torrent_hash}, MediaInfo saved locally only")
    elif not settings.citrus_api_url:
        logger.info("AniBT API URL not configured, skipping push")


def _find_release_id(db: Session, torrent: dict) -> Optional[str]:
    """Find release ID from RSS processed items by matching torrent name."""
    torrent_name = (torrent.get("name") or "").strip()
    if not torrent_name:
        return None

    rss_item = db.query(RSSProcessedItem).filter(
        RSSProcessedItem.title == torrent_name
    ).first()

    if rss_item and rss_item.guid:
        return rss_item.guid

    return None


def _find_video_file_ssh(
    instance: QBTInstance, content_path: str, save_path: str
) -> Optional[str]:
    """Find the main video file on a remote server via SSH."""
    if not content_path and not save_path:
        return None

    path = content_path or save_path
    escaped_path = shlex.quote(path)

    # Check if it's a file and has video extension
    ext = os.path.splitext(path)[1].lower()
    if ext in VIDEO_EXTENSIONS:
        check_cmd = f"test -f {escaped_path} && echo EXISTS"
        ssh_cmd = _build_ssh_cmd(instance, check_cmd)
        try:
            result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=15)
            if "EXISTS" in result.stdout:
                return path
        except Exception as e:
            logger.error(f"SSH error checking file {path}: {e}")
        return None

    # It's a directory — find the largest video file
    find_cmd = (
        f"find {escaped_path} -maxdepth 3 -type f "
        f"\\( -name '*.mkv' -o -name '*.mp4' -o -name '*.avi' -o -name '*.ts' -o -name '*.m2ts' -o -name '*.webm' \\) "
        f"-printf '%s %p\\n' 2>/dev/null | sort -rn | head -1"
    )
    ssh_cmd = _build_ssh_cmd(instance, find_cmd)
    try:
        result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=15)
        output = result.stdout.strip()
        if output:
            # Format: "size /path/to/file"
            parts = output.split(" ", 1)
            if len(parts) == 2:
                return parts[1]
    except Exception as e:
        logger.error(f"SSH error finding video in {path}: {e}")

    return None


def _run_mediainfo_ssh(instance: QBTInstance, file_path: str) -> Optional[str]:
    """Run mediainfo on a remote server via SSH."""
    escaped_path = shlex.quote(file_path)
    remote_cmd = f"mediainfo --Output=JSON {escaped_path}"
    ssh_cmd = _build_ssh_cmd(instance, remote_cmd)

    try:
        result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            logger.error(f"Remote mediainfo failed for {file_path}: {result.stderr}")
            return None
        return result.stdout
    except subprocess.TimeoutExpired:
        logger.error(f"Remote mediainfo timed out for {file_path}")
        return None
    except Exception as e:
        logger.error(f"SSH error running mediainfo: {e}")
        return None


def _run_mediainfo_html_ssh(instance: QBTInstance, file_path: str) -> Optional[str]:
    """Run mediainfo --Output=HTML on a remote server via SSH."""
    escaped_path = shlex.quote(file_path)
    remote_cmd = f"mediainfo --Output=HTML {escaped_path}"
    ssh_cmd = _build_ssh_cmd(instance, remote_cmd)

    try:
        result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            logger.error(f"Remote mediainfo HTML failed for {file_path}: {result.stderr}")
            return None
        return result.stdout
    except Exception as e:
        logger.error(f"SSH error running mediainfo HTML: {e}")
        return None


def _sanitize_raw_html(raw_html: str, file_name: str) -> str:
    """Strip wrapper tags and sanitize server paths from HTML mediainfo output."""
    import re
    # Replace full server path in "Complete name" cell with just the filename
    raw_html = re.sub(
        r'(<td class="Prefix">Complete name :</td>\s*<td>)[^<]*(</td>)',
        rf'\g<1>{re.escape(file_name)}\g<2>',
        raw_html,
    )
    # Strip <html><head>...<body> wrapper
    raw_html = re.sub(r'^.*?<body>\s*', '', raw_html, flags=re.DOTALL)
    raw_html = re.sub(r'\s*</body>\s*</html>\s*$', '', raw_html, flags=re.DOTALL)
    return raw_html.strip()


def _parse_mediainfo(raw_json: str, file_path: str) -> Optional[dict]:
    """Parse mediainfo JSON output into structured format for Citrus."""
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError:
        logger.error(f"Invalid JSON from mediainfo for {file_path}")
        return None

    media = data.get("media", {})
    tracks = media.get("track", [])

    general = {}
    video_tracks = []
    audio_tracks = []
    subtitle_tracks = []

    for track in tracks:
        track_type = track.get("@type", "").lower()

        if track_type == "general":
            general = {
                "format": track.get("Format", "Unknown"),
                "fileSize": _safe_int(track.get("FileSize", 0)),
                "duration": _safe_float(track.get("Duration", 0)),
                "overallBitRate": _safe_int(track.get("OverallBitRate")),
            }
        elif track_type == "video":
            video_tracks.append({
                "format": track.get("Format", "Unknown"),
                "formatProfile": track.get("Format_Profile"),
                "width": _safe_int(track.get("Width", 0)),
                "height": _safe_int(track.get("Height", 0)),
                "bitRate": _safe_int(track.get("BitRate")),
                "frameRate": _safe_float(track.get("FrameRate")),
                "bitDepth": _safe_int(track.get("BitDepth")),
                "colorSpace": track.get("ColorSpace"),
                "hdrFormat": track.get("HDR_Format") or track.get("HDR_Format_Compatibility"),
            })
        elif track_type == "audio":
            audio_tracks.append({
                "format": track.get("Format", "Unknown"),
                "channels": _safe_int(track.get("Channels")),
                "channelLayout": track.get("ChannelLayout"),
                "samplingRate": _safe_int(track.get("SamplingRate")),
                "bitRate": _safe_int(track.get("BitRate")),
                "language": track.get("Language"),
                "title": track.get("Title"),
                "isDefault": track.get("Default") == "Yes",
            })
        elif track_type == "text":
            subtitle_tracks.append({
                "format": track.get("Format", "Unknown"),
                "language": track.get("Language"),
                "title": track.get("Title"),
                "isDefault": track.get("Default") == "Yes",
                "isForced": track.get("Forced") == "Yes",
            })

    if not general:
        return None

    # Remove None values
    general = {k: v for k, v in general.items() if v is not None}
    video_tracks = [{k: v for k, v in t.items() if v is not None} for t in video_tracks]
    audio_tracks = [{k: v for k, v in t.items() if v is not None} for t in audio_tracks]
    subtitle_tracks = [{k: v for k, v in t.items() if v is not None} for t in subtitle_tracks]

    return {
        "general": general,
        "video": video_tracks,
        "audio": audio_tracks,
        "subtitle": subtitle_tracks,
        "fileName": os.path.basename(file_path),
    }


def _push_to_citrus(release_id: str, info_hash: str, structured: dict) -> bool:
    """Push MediaInfo data to AniBT API."""
    url = f"{settings.citrus_api_url.rstrip('/')}/api/releases/mediainfo"
    headers = {
        "Authorization": f"Bearer {settings.citrus_mediainfo_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "releaseId": release_id,
        "infoHash": info_hash,
        **structured,
    }

    try:
        with httpx.Client(timeout=30) as client:
            resp = client.put(url, json=payload, headers=headers)
            if resp.status_code == 200:
                return True
            logger.error(f"Citrus API returned {resp.status_code}: {resp.text}")
            return False
    except Exception as e:
        logger.error(f"Failed to push MediaInfo to Citrus: {e}")
        return False


def _save_error(
    db: Session,
    torrent_hash: str,
    instance_id: int,
    error: str,
    existing: Optional[MediaInfoRecord],
):
    """Save error information for a torrent."""
    try:
        record = existing or MediaInfoRecord(torrent_hash=torrent_hash)
        record.instance_id = instance_id
        record.error_message = error[:500]
        if not existing:
            db.add(record)
        db.commit()
    except Exception as e:
        logger.error(f"Failed to save error record: {e}")
        db.rollback()


def _safe_int(value) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _safe_float(value) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None
