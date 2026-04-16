from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import jwt as pyjwt
import time
from collections import defaultdict

from app.config import settings as app_settings
from app.database import init_db
from app.api import auth, instances, rss, settings, stats, telegram, mediainfo

app = FastAPI(
    title="AniBT-Speed API",
    description="种群加速管理平台 API",
    version="0.1.0",
)

# CORS: use configured origins, fall back to same-origin only
_cors_origins = [o.strip() for o in app_settings.cors_origins.split(",") if o.strip()] if app_settings.cors_origins else []
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=bool(_cors_origins),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Login rate limiting: max 5 attempts per IP per 15 minutes
_login_attempts: dict[str, list[float]] = defaultdict(list)
_MAX_LOGIN_ATTEMPTS = 5
_LOGIN_WINDOW_SECONDS = 900

# JWT token blacklist (in-memory; cleared on restart)
_token_blacklist: set[str] = set()


def blacklist_token(token: str):
    _token_blacklist.add(token)


def is_token_blacklisted(token: str) -> bool:
    return token in _token_blacklist


def _check_login_rate(ip: str) -> bool:
    """Returns True if login is allowed, False if rate limited."""
    now = time.monotonic()
    attempts = _login_attempts[ip]
    # Remove expired entries
    _login_attempts[ip] = [t for t in attempts if now - t < _LOGIN_WINDOW_SECONDS]
    return len(_login_attempts[ip]) < _MAX_LOGIN_ATTEMPTS


def record_login_attempt(ip: str):
    _login_attempts[ip].append(time.monotonic())


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if request.method == "OPTIONS":
        return await call_next(request)

    # Rate limit login attempts
    if path == "/api/auth/login" and request.method == "POST":
        client_ip = request.client.host if request.client else "unknown"
        if not _check_login_rate(client_ip):
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many login attempts. Try again later."},
            )

    if path == "/api/health" or path == "/api/auth/login" or path == "/api/auth/logout" or not path.startswith("/api/"):
        return await call_next(request)

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})

    token = auth_header[7:]
    if is_token_blacklisted(token):
        return JSONResponse(status_code=401, content={"detail": "Token revoked"})

    try:
        pyjwt.decode(token, app_settings.secret_key, algorithms=["HS256"])
    except pyjwt.ExpiredSignatureError:
        return JSONResponse(status_code=401, content={"detail": "Token expired"})
    except pyjwt.InvalidTokenError:
        return JSONResponse(status_code=401, content={"detail": "Invalid token"})

    return await call_next(request)


app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])

app.include_router(instances.router, prefix="/api/instances", tags=["Instances"])
app.include_router(rss.router, prefix="/api/rss", tags=["RSS"])
app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])
app.include_router(stats.router, prefix="/api/stats", tags=["Stats"])
app.include_router(telegram.router, prefix="/api/telegram", tags=["Telegram"])
app.include_router(mediainfo.router, prefix="/api/mediainfo", tags=["MediaInfo"])


@app.on_event("startup")
async def startup():
    import logging
    logger = logging.getLogger(__name__)
    try:
        init_db()
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        raise
    from app.scheduler import start_scheduler
    start_scheduler()


@app.get("/api/health")
async def health():
    return {"status": "ok"}
