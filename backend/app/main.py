from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import jwt as pyjwt

from app.config import settings as app_settings
from app.database import init_db
from app.api import auth, instances, rss, settings, stats, telegram, mediainfo

app = FastAPI(
    title="AniBT-Speed API",
    description="种群加速管理平台 API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if request.method == "OPTIONS":
        return await call_next(request)
    if path == "/api/health" or path == "/api/auth/login" or not path.startswith("/api/"):
        return await call_next(request)

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})

    token = auth_header[7:]
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
    init_db()
    from app.scheduler import start_scheduler
    start_scheduler()


@app.get("/api/health")
async def health():
    return {"status": "ok"}
