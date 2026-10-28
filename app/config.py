"""Reads settings from environment variables (.env file locally)."""
import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()  # does not override variables that are already set


class ConfigError(RuntimeError):
    pass


@dataclass
class Settings:
    db_url: str
    secret_key: str
    production: bool
    timezone: str


def get_settings() -> Settings:
    db = os.getenv("DATABASE_URL", "").strip()
    key = os.getenv("SECRET_KEY", "").strip()
    if not db:
        raise ConfigError("DATABASE_URL is missing. Copy .env.example to .env and fill it in.")
    if len(key) < 32:
        raise ConfigError("SECRET_KEY is missing or too short (min 32 chars). See SETUP_GUIDE_WINDOWS.md, step 11.")
    for old in ("postgres://", "postgresql://"):
        if db.startswith(old):
            db = "postgresql+psycopg2://" + db[len(old):]
    return Settings(db, key, os.getenv("APP_ENV", "development").lower() == "production",
                    os.getenv("APP_TIMEZONE", "Asia/Manila"))
