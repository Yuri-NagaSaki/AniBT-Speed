"""Download layout from AniBT metadata, without guessing identities from titles."""

import re

from app.config import Settings


def component(value: str, fallback: str = "其他") -> str:
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value)
    value = re.sub(r"\s+", " ", value).strip(" .").replace(",", "，")
    return value.encode()[:200].decode("utf-8", errors="ignore").rstrip(" .") or fallback


def season_label(value: str) -> str:
    match = re.fullmatch(
        r"(\d{4})\s*[-_/]?\s*(春季?|夏季?|秋季?|冬季?|WINTER|SPRING|SUMMER|FALL|AUTUMN)", value.strip(), re.I
    )
    if not match:
        return "其他"
    names = {"WINTER": "冬季", "SPRING": "春季", "SUMMER": "夏季", "FALL": "秋季", "AUTUMN": "秋季"}
    suffix = names.get(match[2].upper(), match[2][0] + "季")
    return match[1] + suffix


def download_layout(metadata: dict, season: str, settings: Settings) -> tuple[str, str]:
    group = component(metadata.get("group_name") or metadata["group_slug"])
    title = component(metadata.get("anime_title") or metadata.get("anime_title_english") or metadata["release_title"])
    label = season_label(season)
    folders = [group, "合集"] if metadata["group_slug"] == "ktnbytes" else [group, label, title]
    path = settings.download_root.rstrip("/") + "/" + "/".join(folders)
    tags = [
        settings.managed_tag,
        "字幕组:" + group,
        "group:" + metadata["group_slug"],
        "季度:" + ("合集" if metadata["group_slug"] == "ktnbytes" else label),
    ]
    return path, ",".join(dict.fromkeys(tag for tag in tags if tag))
