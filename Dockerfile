FROM python:3.14-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.9.18 /uv /bin/uv
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/app ./app
RUN uv sync --frozen --no-dev --no-editable

FROM python:3.14-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates mediainfo util-linux \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY backend/app ./app
ARG BUILD_REVISION=development
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    BUILD_REVISION=$BUILD_REVISION \
    STATE_DIR=/app/data
LABEL org.opencontainers.image.title="AniBT-Speed" \
    org.opencontainers.image.revision=$BUILD_REVISION
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["python", "-m", "app", "status", "--live"]
CMD ["python", "-m", "app", "run"]
