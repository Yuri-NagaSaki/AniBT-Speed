"""Pure queue planning. A plan never changes qB state or the exposure history."""

from app.config import Settings
from app.domain import SEEDING, STOPPED, TRANSITIONING, Command, Exposure, Torrent


def plan_queue(
    torrents: tuple[Torrent, ...],
    settings: Settings,
    exposures: dict[str, Exposure],
    now: float,
    *,
    rotate: bool = True,
) -> list[Command]:
    if not settings.pool_enabled:
        return []
    managed = [t for t in torrents if t.managed(settings) and t.progress >= 1]
    active = [t for t in managed if t.state in SEEDING]
    stopped = [t for t in managed if t.state in STOPPED]
    reserved = sum(t.state in TRANSITIONING or t.state == "forcedUP" for t in managed)

    def hot(t: Torrent) -> bool:
        completed = t.completion_on or t.added_on
        return not completed or now - completed < settings.hot_hours * 3600

    def protected(t: Torrent) -> bool:
        return hot(t) or t.has_demand(settings)

    def exposed(t: Torrent, seconds: float) -> bool:
        started = exposures.get(t.hash, Exposure()).started_at
        return started > 0 and now - started >= seconds

    # Least recently exposed first; the persistent timestamp survives library changes/restarts.
    stopped.sort(key=lambda t: (exposures.get(t.hash, Exposure()).last_started_at, t.added_on, t.hash))
    idle = sorted(
        (t for t in active if not protected(t)), key=lambda t: (exposures.get(t.hash, Exposure()).started_at, t.hash)
    )
    resume = [t for t in stopped if protected(t)][: settings.pool_batch]
    resumed_hashes = {t.hash for t in resume}
    remaining = [t for t in stopped if t.hash not in resumed_hashes]
    pause: list[Torrent] = []

    projected = len(active) + reserved + len(resume)
    excess = max(0, projected - settings.pool_target)
    pause = idle[: min(excess, settings.pool_batch)]
    slots = max(0, settings.pool_target - projected + len(pause))
    fill = remaining[: min(slots, max(0, settings.pool_batch - len(resume)))]
    resume.extend(fill)
    remaining = remaining[len(fill) :]
    # Rotation has a minimum exposure time; a 30s control tick is not a 30s rotation.
    paused_hashes = {t.hash for t in pause}
    candidates = [t for t in idle if t.hash not in paused_hashes and exposed(t, settings.exposure_seconds)]
    swap = min(
        settings.rotation_batch,
        len(candidates),
        len(remaining),
        max(0, settings.pool_batch - len(pause)),
        max(0, settings.pool_batch - len(resume)),
    )
    swap = swap if rotate else 0
    pause.extend(candidates[:swap])
    resume.extend(remaining[:swap])

    commands = []
    if pause:
        commands.append(Command("pause", tuple(t.hash for t in pause), "idle seed rotation"))
    if resume:
        commands.append(Command("resume", tuple(t.hash for t in resume), "seed demand or fair rotation"))
    return commands
