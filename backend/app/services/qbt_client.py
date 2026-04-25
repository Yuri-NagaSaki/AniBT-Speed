from typing import Optional
import time
import qbittorrentapi
import logging

logger = logging.getLogger(__name__)

# Session stays valid for 5 minutes before forcing a re-login
_SESSION_TTL = 300


class QBTClient:
    """Wraps qbittorrent-api for a single qBittorrent instance."""

    def __init__(self, url: str, username: str, password: str):
        self.url = url
        self.username = username
        self.password = password
        self._client: Optional[qbittorrentapi.Client] = None
        self._connected_at: float = 0

    def _connect(self, force: bool = False) -> qbittorrentapi.Client:
        now = time.monotonic()
        if not force and self._client and (now - self._connected_at) < _SESSION_TTL:
            return self._client
        host = self.url.rstrip("/")
        self._client = qbittorrentapi.Client(
            host=host,
            username=self.username,
            password=self.password,
            VERIFY_WEBUI_CERTIFICATE=False,
        )
        self._client.auth_log_in()
        self._connected_at = now
        return self._client

    def _ensure_client(self) -> qbittorrentapi.Client:
        """Get client, reconnecting on auth/connection errors."""
        try:
            c = self._connect()
            # Probe to verify the session is still alive
            c.app.version
            return c
        except (qbittorrentapi.Forbidden403Error, qbittorrentapi.APIConnectionError):
            logger.debug("Session expired or connection lost, reconnecting...")
            return self._connect(force=True)

    @property
    def client(self) -> qbittorrentapi.Client:
        return self._ensure_client()

    def test_connection(self) -> dict:
        try:
            c = self._connect(force=True)
            version = c.app.version
            return {"success": True, "version": version}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_status(self) -> dict:
        c = self.client
        info = c.transfer_info()
        return {
            "dl_speed": info.get("dl_info_speed", 0),
            "up_speed": info.get("up_info_speed", 0),
            "dl_total": info.get("dl_info_data", 0),
            "up_total": info.get("up_info_data", 0),
            "connection_status": info.get("connection_status", "unknown"),
        }

    def get_torrents(self, **kwargs) -> list:
        return [t.info for t in self.client.torrents.info(**kwargs)]

    def get_torrent_count(self) -> dict:
        torrents = self.client.torrents.info()
        active = sum(1 for t in torrents if t.state in ("uploading", "downloading", "stalledUP", "stalledDL"))
        paused = sum(1 for t in torrents if t.state in ("pausedUP", "pausedDL"))
        return {"total": len(torrents), "active": active, "paused": paused}

    def get_storage_status(self, save_path: str = "") -> dict:
        """Estimate qBittorrent storage usage from WebUI data."""
        c = self.client
        maindata = c.sync_maindata(rid=0)
        server_state = maindata.get("server_state", {}) if maindata else {}
        free_bytes = int(server_state.get("free_space_on_disk") or 0)

        torrents = c.torrents.info()
        normalized_path = save_path.rstrip("/")
        used_bytes = 0
        for torrent in torrents:
            torrent_path = (getattr(torrent, "save_path", "") or "").rstrip("/")
            if normalized_path and torrent_path and not torrent_path.startswith(normalized_path):
                continue
            used_bytes += int(getattr(torrent, "size", 0) or 0)

        total_bytes = used_bytes + free_bytes
        used_percent = (used_bytes / total_bytes) * 100 if total_bytes > 0 else 0
        return {
            "path": save_path,
            "used": used_bytes,
            "free": free_bytes,
            "total": total_bytes,
            "used_percent": used_percent,
            "source": "qbt",
        }

    def delete_torrent(self, torrent_hash: str, delete_files: bool = True):
        self.client.torrents_delete(delete_files=delete_files, torrent_hashes=torrent_hash)

    def pause_torrent(self, torrent_hash: str):
        self.client.torrents_pause(torrent_hashes=torrent_hash)

    def resume_torrent(self, torrent_hash: str):
        self.client.torrents_resume(torrent_hashes=torrent_hash)

    def set_speed_limits(self, dl_limit: int = 0, up_limit: int = 0):
        self.client.transfer_set_download_limit(limit=dl_limit)
        self.client.transfer_set_upload_limit(limit=up_limit)

    def add_rss_feed(self, url: str, path: str = ""):
        self.client.rss_add_feed(url=url, item_path=path)

    def remove_rss_feed(self, path: str):
        self.client.rss_remove_item(item_path=path)

    def set_rss_rule(self, rule_name: str, rule_def: dict):
        self.client.rss_set_rule(rule_name=rule_name, rule_def=rule_def)

    def remove_rss_rule(self, rule_name: str):
        self.client.rss_remove_rule(rule_name=rule_name)

    def create_tags(self, tags: list[str]):
        self.client.torrents_create_tags(tags=tags)

    def add_tags_to_torrents(self, torrent_hashes: str, tags: str):
        self.client.torrents_add_tags(tags=tags, torrent_hashes=torrent_hashes)

    def add_torrent_url(self, url: str, save_path: str = "", tags: str = "", category: str = "") -> bool:
        """Add a torrent by URL or magnet link. Returns True on success."""
        before_hashes: set[str] = set()
        if tags:
            before_hashes = {t.hash for t in self.client.torrents.info()}

        kwargs: dict = {"urls": url}
        if save_path:
            kwargs["save_path"] = save_path
        if tags:
            kwargs["tags"] = tags
        if category:
            kwargs["category"] = category
        result = self.client.torrents_add(**kwargs)
        ok = result == "Ok."

        if ok and tags:
            after_hashes = {t.hash for t in self.client.torrents.info()}
            for torrent_hash in after_hashes - before_hashes:
                self.add_tags_to_torrents(torrent_hash, tags)

        return ok


_instances: dict[int, QBTClient] = {}


def get_qbt_client(instance_id: int, url: str, username: str, password: str) -> QBTClient:
    existing = _instances.get(instance_id)
    if existing and existing.url == url and existing.username == username and existing.password == password:
        return existing
    client = QBTClient(url, username, password)
    _instances[instance_id] = client
    return client


def remove_qbt_client(instance_id: int):
    _instances.pop(instance_id, None)
