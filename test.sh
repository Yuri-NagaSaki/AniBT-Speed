#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
test -z "$(gofmt -l cmd internal)"
go vet ./...
go test -race ./...
python3 -m unittest discover -s scripts -p '*_test.py'
