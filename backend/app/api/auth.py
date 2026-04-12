from fastapi import APIRouter, HTTPException
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
def login(body: LoginRequest):
    if body.password != settings.admin_password:
        raise HTTPException(status_code=401, detail="Invalid password")

    payload = {
        "sub": "admin",
        "exp": datetime.datetime.now(datetime.UTC) + datetime.timedelta(days=7),
        "iat": datetime.datetime.now(datetime.UTC),
    }
    token = jwt.encode(payload, settings.secret_key, algorithm="HS256")
    return {"token": token}
