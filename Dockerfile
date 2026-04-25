# Stage 1: build the Vite frontend
FROM node:20-alpine AS frontend-builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /build/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

COPY frontend/ ./
RUN pnpm run build


# Stage 2: run FastAPI and serve the built frontend from the same process
FROM python:3.14-slim

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

RUN apt-get update \
    && apt-get install -y --no-install-recommends mediainfo openssh-client \
    && rm -rf /var/lib/apt/lists/*

COPY backend/pyproject.toml ./
RUN uv sync --frozen --no-dev --no-install-project 2>/dev/null \
    || uv sync --no-dev --no-install-project

COPY backend/ ./
COPY --from=frontend-builder /build/frontend/dist /app/static

RUN mkdir -p /app/data

ENV FRONTEND_DIST=/app/static

EXPOSE 6868

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "6868"]
