#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
arch="${1:-amd64}"
case "$arch" in amd64|arm64) ;; *) exit 2;; esac
revision="$(git rev-parse HEAD)"
output="dist/linux-$arch"
mkdir -p "$output"
CGO_ENABLED=0 GOOS=linux GOARCH="$arch" go build -trimpath -ldflags="-s -w -X github.com/Yuri-NagaSaki/AniBT-Speed/internal/anibt.Revision=$revision" -o "$output/anibt" ./cmd/anibt
cp deploy/anibt.service "$output/anibt.service"
python3 - "$output" "$revision" "$arch" <<'PY'
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1])
(root/'manifest.json').write_text(json.dumps({'version':'2.1.0','revision':sys.argv[2],'schema':3,'os':'linux','arch':sys.argv[3]},indent=2)+'\n')
(root/'SHA256SUMS').write_text(''.join(hashlib.sha256((root/name).read_bytes()).hexdigest()+'  '+name+'\n' for name in ['anibt','anibt.service','manifest.json']))
PY
