#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
uv sync --directory backend --frozen
uv run --directory backend ruff check app tests benchmarks
uv run --directory backend ruff format --check app tests benchmarks
uv run --directory backend python -m unittest discover -s tests -t . -v
