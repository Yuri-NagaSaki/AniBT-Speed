from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.api import instances, rss, settings, stats, telegram

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

app.include_router(instances.router, prefix="/api/instances", tags=["Instances"])
app.include_router(rss.router, prefix="/api/rss", tags=["RSS"])
app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])
app.include_router(stats.router, prefix="/api/stats", tags=["Stats"])
app.include_router(telegram.router, prefix="/api/telegram", tags=["Telegram"])


@app.on_event("startup")
async def startup():
    init_db()
    from app.scheduler import start_scheduler
    start_scheduler()


@app.get("/api/health")
async def health():
    return {"status": "ok"}
