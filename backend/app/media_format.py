"""AniBT MediaInfo payloads from a single JSON extraction per sampled file."""

import json
import math
from pathlib import PurePosixPath

MEDIA_EXTENSIONS = frozenset(
    {
        ".mkv",
        ".mp4",
        ".avi",
        ".mov",
        ".webm",
        ".m4v",
        ".ts",
        ".m2ts",
        ".mts",
        ".wmv",
        ".flv",
        ".mpg",
        ".mpeg",
        ".rmvb",
        ".rm",
        ".ogv",
        ".vob",
        ".3gp",
        ".asf",
        ".f4v",
    }
)


def number(value, *, integer=False):
    try:
        result = float(value)
        return (int(result) if integer else result) if math.isfinite(result) else None
    except ValueError, TypeError, OverflowError:
        return None


def parse_tracks(data: dict) -> dict:
    result = {"general": {}, "video": [], "audio": [], "subtitle": []}
    for track in data.get("media", {}).get("track", []):
        kind = track.get("@type")
        match kind:
            case "General":
                result["general"] = {
                    "format": track.get("Format", "Unknown"),
                    "fileSize": number(track.get("FileSize"), integer=True) or 0,
                    "duration": number(track.get("Duration")) or 0,
                    "overallBitRate": number(track.get("OverallBitRate"), integer=True),
                }
            case "Video":
                result["video"].append(
                    {
                        "format": track.get("Format", "Unknown"),
                        "formatProfile": track.get("Format_Profile"),
                        "width": number(track.get("Width"), integer=True) or 0,
                        "height": number(track.get("Height"), integer=True) or 0,
                        "bitRate": number(track.get("BitRate"), integer=True),
                        "frameRate": number(track.get("FrameRate")),
                        "bitDepth": number(track.get("BitDepth"), integer=True),
                        "colorSpace": track.get("ColorSpace"),
                        "hdrFormat": track.get("HDR_Format"),
                    }
                )
            case "Audio":
                result["audio"].append(
                    {
                        "format": track.get("Format", "Unknown"),
                        "channels": number(track.get("Channels"), integer=True),
                        "channelLayout": track.get("ChannelLayout"),
                        "samplingRate": number(track.get("SamplingRate"), integer=True),
                        "bitRate": number(track.get("BitRate"), integer=True),
                        "language": track.get("Language"),
                        "title": track.get("Title"),
                        "isDefault": str(track.get("Default", "")).lower() in {"yes", "true", "1"},
                    }
                )
            case "Text":
                result["subtitle"].append(
                    {
                        "format": track.get("Format", "Unknown"),
                        "language": track.get("Language"),
                        "title": track.get("Title"),
                        "isDefault": str(track.get("Default", "")).lower() in {"yes", "true", "1"},
                        "isForced": str(track.get("Forced", "")).lower() in {"yes", "true", "1"},
                    }
                )
    result["general"] = {key: value for key, value in result["general"].items() if value is not None}
    for kind in ("video", "audio", "subtitle"):
        result[kind] = [
            {key: value for key, value in track.items() if value is not None} for track in result[kind][:64]
        ]
    if not result["general"] or not (result["video"] or result["audio"]):
        raise ValueError("MediaInfo found no media tracks")
    return result


def select_samples(files: list[dict], limit: int) -> list[dict]:
    media = sorted(
        (
            file
            for file in files
            if PurePosixPath(file["name"]).suffix.lower() in MEDIA_EXTENSIONS and file.get("progress", 1) >= 1
        ),
        key=lambda file: file["name"],
    )
    if len(media) <= limit:
        return media
    indices = {max(range(len(media)), key=lambda index: media[index]["size"])}
    for index in range(limit):
        indices.add(round(index * (len(media) - 1) / max(1, limit - 1)))
        if len(indices) >= limit:
            break
    for index in range(len(media)):
        if len(indices) >= limit:
            break
        indices.add(index)
    return [media[index] for index in sorted(indices)]


def payload_for_files(infohash: str, name: str, files: list[dict], parsed: dict[str, dict], max_bytes: int) -> dict:
    representative = max((file for file in files if file["name"] in parsed), key=lambda file: file["size"])
    payload = {**parsed[representative["name"]], "infoHash": infohash, "fileName": name}
    payload["general"] = dict(payload["general"])
    media_count = sum(PurePosixPath(file["name"]).suffix.lower() in MEDIA_EXTENSIONS for file in files)
    lines = [
        name,
        f"Files: {len(files)}; media files: {media_count}; sampled: {len(parsed)}",
        f"Representative: {representative['name']}",
    ]
    if len(files) > 1:
        payload["general"]["fileSize"] = sum(int(file["size"]) for file in files)
        payload["general"].pop("overallBitRate", None)
        if len(parsed) == media_count:
            payload["general"]["duration"] = sum(value["general"].get("duration", 0) for value in parsed.values())
        else:
            payload["general"].pop("duration", None)
            lines.append("Collection duration is unknown; unsampled files are not extrapolated.")
    for filename, tracks in parsed.items():
        lines.extend(["", filename])
        for kind, values in tracks.items():
            lines.append(kind.capitalize())
            for track in values if isinstance(values, list) else [values]:
                lines.extend(f"  {key}: {value}" for key, value in track.items())
    lines.extend(["", "File list (relative to torrent save directory):"])
    lines.extend(f"{file['name']} | {file['size']} bytes" for file in files)
    raw = "\n".join(lines)
    base_bytes = len(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode())
    budget = max_bytes - base_bytes - 100
    if budget < 0:
        raise ValueError("Structured MediaInfo exceeds payload limit")
    # JSON escaping adds bytes; enforce the limit on the final serialized payload.
    payload["rawText"] = raw.encode()[:budget].decode("utf-8", errors="ignore")
    while len(json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()) > max_bytes:
        payload["rawText"] = payload["rawText"][: int(len(payload["rawText"]) * 0.9)]
    return payload
