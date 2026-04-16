import os
import secrets

from pydantic_settings import BaseSettings


def _generate_secret() -> str:
    """Generate a secure random secret key if none is provided."""
    return secrets.token_urlsafe(32)


class Settings(BaseSettings):
    """Minimal env-level settings. All other config lives in the database
    and is managed through the frontend UI."""
    secret_key: str = ""
    admin_password: str = ""
    database_url: str = "sqlite:///./data/anibt_speed.db"
    cors_origins: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

# Auto-generate secret_key if not set or using insecure defaults
_INSECURE_SECRETS = {"", "change-me", "change-me-to-a-random-string"}
if settings.secret_key in _INSECURE_SECRETS:
    settings.secret_key = _generate_secret()

_INSECURE_PASSWORDS = {"", "admin"}
if settings.admin_password in _INSECURE_PASSWORDS:
    import logging
    logging.getLogger(__name__).warning(
        "ADMIN_PASSWORD is not set or using default. "
        "Set ADMIN_PASSWORD env variable for production use."
    )
