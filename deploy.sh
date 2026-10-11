#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
test -f worker.env || { echo 'Missing worker.env; copy worker.env.example and configure credentials.' >&2; exit 1; }
command -v docker >/dev/null
docker compose version >/dev/null
mkdir -p data
backup_dir="${DEPLOY_BACKUP_DIR:-./backups/$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
cp worker.env "$backup_dir/worker.env"
chmod 600 "$backup_dir/worker.env"
previous_image="$(docker inspect -f '{{.Image}}' anibt-speed 2>/dev/null || true)"
printf '%s\n' "$previous_image" > "$backup_dir/previous-image"
if [[ "${BUILD_LOCAL:-0}" == 1 ]]; then
  export BUILD_REVISION="${BUILD_REVISION:-$(git rev-parse HEAD)}"
  export ANIBT_SPEED_IMAGE="${ANIBT_SPEED_IMAGE:-anibt-speed:$BUILD_REVISION}"
  docker compose build --pull worker
else
  docker compose pull worker
fi

rollback() {
  echo "Deployment failed; restoring previous image. Backup: $backup_dir" >&2
  if [[ -n "$previous_image" ]]; then
    ANIBT_SPEED_IMAGE="$previous_image" docker compose up -d --no-build --remove-orphans
  fi
}
trap rollback ERR
# Snapshot through SQLite's backup API after the old writer has stopped.
if [[ -n "$previous_image" ]]; then
  docker stop --time 40 anibt-speed >/dev/null
fi
if [[ -f data/state.sqlite3 ]]; then
  docker compose run --rm --no-deps -T --entrypoint python worker - "$backup_dir" <<'PY'
import sqlite3
source=sqlite3.connect('/app/data/state.sqlite3')
target=sqlite3.connect('/app/data/deploy-backup.sqlite3')
source.backup(target)
target.close()
source.close()
PY
  mv data/deploy-backup.sqlite3 "$backup_dir/state.sqlite3"
fi
docker compose up -d --no-build --remove-orphans
for attempt in $(seq 1 30); do
  if docker exec anibt-speed python -m app status >/dev/null 2>&1; then
    docker exec anibt-speed python -m app status
    trap - ERR
    echo "Deployed. Backup: $backup_dir"
    exit 0
  fi
  sleep 2
done
false
