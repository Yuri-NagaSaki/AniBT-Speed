from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Minimal env-level settings. All other config lives in the database
    and is managed through the frontend UI."""
    secret_key: str = "change-me"
    admin_password: str = "admin"
    database_url: str = "sqlite:///./data/anibt_speed.db"

    # Citrus MediaInfo API
    citrus_api_url: str = ""
    citrus_mediainfo_token: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
