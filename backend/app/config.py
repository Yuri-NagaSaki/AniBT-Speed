import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    secret_key: str = "change-me"
    admin_password: str = "admin"
    database_url: str = "sqlite:///./data/anibt_speed.db"

    qbt_url: str = "http://localhost:8181"
    qbt_username: str = "admin"
    qbt_password: str = ""

    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
