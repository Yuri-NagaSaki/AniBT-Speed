from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
import jwt
import datetime
from app.config import settings


router = APIRouter()


class LoginRequest(BaseModel):
    password: str


class LoginResponse(BaseModel):
    token: str


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, request: Request):
    from app.main import record_login_attempt
    client_ip = request.client.host if request.client else "unknown"
    record_login_attempt(client_ip)

    if body.password != settings.admin_password:
        raise HTTPException(status_code=401, detail="Invalid password")

    payload = {
        "sub": "admin",
        "exp": datetime.datetime.now(datetime.UTC) + datetime.timedelta(hours=24),
        "iat": datetime.datetime.now(datetime.UTC),
    }
    token = jwt.encode(payload, settings.secret_key, algorithm="HS256")
    return {"token": token}


@router.post("/logout")
def logout(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        from app.main import blacklist_token
        blacklist_token(token)
    return {"ok": True}
