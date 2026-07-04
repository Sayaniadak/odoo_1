"""
HRMS Backend — Configuration
Reads all settings from the project root .env file.
"""

from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables / .env file."""

    # ── Supabase ─────────────────────────────────────────────────────────────
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str
    SUPABASE_JWT_SECRET: str  # Legacy HS256 fallback; primary verification uses JWKS

    # ── CORS ─────────────────────────────────────────────────────────────────
    FRONTEND_URL: str = "http://localhost:3000"

    # ── Groq LLM ─────────────────────────────────────────────────────────────
    GROQ_API_KEY: str = ""

    # ── Resolve .env relative to this file: backend/app/../../.env ────────────
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parent.parent.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",  # Ignore extra env vars not in the model
    )


# Singleton — imported everywhere as `from backend.app.config import settings`
settings = Settings()
