"""Central configuration. Everything is overridable through environment variables / .env."""
from __future__ import annotations

import logging
import secrets
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger("neurolens.config")

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(ROOT_DIR / ".env"), str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Runtime ---------------------------------------------------------
    env: str = Field("development", alias="NEUROLENS_ENV")  # development | production | test
    data_dir: Path = Field(BACKEND_DIR / "data", alias="DATA_DIR")
    database_url: Optional[str] = Field(None, alias="DATABASE_URL")
    log_level: str = Field("INFO", alias="LOG_LEVEL")

    # --- Secrets ---------------------------------------------------------
    secret_key: Optional[str] = Field(None, alias="SECRET_KEY")
    encryption_key: Optional[str] = Field(None, alias="ENCRYPTION_KEY")  # urlsafe base64 Fernet key

    # --- Auth / sessions -------------------------------------------------
    access_token_minutes: int = 15
    refresh_token_days: int = 14
    allow_registration: bool = True
    password_min_length: int = 10
    max_failed_logins: int = 5
    lockout_minutes: int = 15
    cookie_secure: Optional[bool] = None  # default: True in production
    cookie_samesite: str = "lax"  # use "none" only when frontend is on another site (requires https)
    trust_proxy_headers: bool = Field(False, alias="TRUST_PROXY_HEADERS")  # honour X-Forwarded-For behind a reverse proxy

    # --- URLs / CORS -----------------------------------------------------
    frontend_url: str = Field("http://localhost:5173", alias="FRONTEND_URL")
    public_base_url: str = Field("http://localhost:8000", alias="PUBLIC_BASE_URL")
    cors_origins: List[str] = Field(default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"], alias="CORS_ORIGINS")
    trusted_hosts: List[str] = Field(default_factory=lambda: ["*"], alias="TRUSTED_HOSTS")

    # --- SSO (OpenID Connect / OAuth2) -----------------------------------
    google_client_id: Optional[str] = Field(None, alias="GOOGLE_CLIENT_ID")
    google_client_secret: Optional[str] = Field(None, alias="GOOGLE_CLIENT_SECRET")
    github_client_id: Optional[str] = Field(None, alias="GITHUB_CLIENT_ID")
    github_client_secret: Optional[str] = Field(None, alias="GITHUB_CLIENT_SECRET")
    microsoft_client_id: Optional[str] = Field(None, alias="MICROSOFT_CLIENT_ID")
    microsoft_client_secret: Optional[str] = Field(None, alias="MICROSOFT_CLIENT_SECRET")
    microsoft_tenant: str = Field("common", alias="MICROSOFT_TENANT")

    # --- Platform-level LLM keys (fallback when an org has not set its own) ---
    groq_api_key: Optional[str] = Field(None, alias="GROQ_API_KEY")
    openai_api_key: Optional[str] = Field(None, alias="OPENAI_API_KEY")
    openrouter_api_key: Optional[str] = Field(None, alias="OPENROUTER_API_KEY")
    elevenlabs_api_key: Optional[str] = Field(None, alias="ELEVENLABS_API_KEY")
    allow_platform_keys: bool = Field(True, alias="ALLOW_PLATFORM_KEYS")
    default_groq_model: str = Field("qwen/qwen3.8-27b", alias="DEFAULT_GROQ_MODEL")
    default_openai_model: str = Field("gpt-4o-mini", alias="DEFAULT_OPENAI_MODEL")
    default_openrouter_model: str = Field("deepseek/deepseek-chat", alias="DEFAULT_OPENROUTER_MODEL")
    vision_model_groq: str = Field("meta-llama/llama-4-scout-17b-16e-instruct", alias="VISION_MODEL_GROQ")
    vision_model_openai: str = Field("gpt-4o-mini", alias="VISION_MODEL_OPENAI")
    vision_model_openrouter: str = Field("openai/gpt-4o-mini", alias="VISION_MODEL_OPENROUTER")
    llm_timeout_seconds: float = 60.0

    # --- RAG -------------------------------------------------------------
    embedding_backend: str = Field("sentence-transformers", alias="EMBEDDING_BACKEND")  # or "hash"
    embedding_model: str = Field("sentence-transformers/all-MiniLM-L6-v2", alias="EMBEDDING_MODEL")
    chunk_size: int = 800
    chunk_overlap: int = 150
    # A passage is used (and shown as a source) only if its cosine similarity to the question reaches this value,
    # or most of the question's content words literally appear in it. Stops unrelated chunks being cited.
    retrieval_min_score: float = Field(0.28, alias="RETRIEVAL_MIN_SCORE")
    # Scanned PDFs (no text layer) are read by the vision model page by page; this caps pages per document.
    max_ocr_pages: int = Field(15, alias="MAX_OCR_PAGES")

    # --- Limits & guardrails --------------------------------------------
    max_upload_mb: int = Field(25, alias="MAX_UPLOAD_MB")
    max_files_per_upload: int = 10
    max_pdf_pages: int = 1000
    org_storage_mb: int = Field(500, alias="ORG_STORAGE_MB")
    max_query_chars: int = 4000
    max_history_messages: int = 12
    max_output_chars: int = 20000
    url_fetch_max_mb: int = 5
    org_daily_query_quota: int = Field(500, alias="ORG_DAILY_QUERY_QUOTA")
    rate_limit_per_minute: int = Field(60, alias="RATE_LIMIT_PER_MINUTE")  # per user, general API
    chat_rate_limit_per_minute: int = Field(20, alias="CHAT_RATE_LIMIT_PER_MINUTE")
    auth_rate_limit_per_minute: int = Field(10, alias="AUTH_RATE_LIMIT_PER_MINUTE")  # per IP
    guardrail_mode: str = Field("block", alias="GUARDRAIL_MODE")  # block | flag | off

    @field_validator("cors_origins", "trusted_hosts", mode="before")
    @classmethod
    def _split_csv(cls, v):
        if isinstance(v, str):
            s = v.strip()
            if s.startswith("["):
                import json

                return json.loads(s)
            return [p.strip() for p in s.split(",") if p.strip()]
        return v

    # --- Derived ---------------------------------------------------------
    @property
    def is_production(self) -> bool:
        return self.env.lower() == "production"

    @property
    def is_test(self) -> bool:
        return self.env.lower() == "test"

    @property
    def effective_cookie_secure(self) -> bool:
        return self.is_production if self.cookie_secure is None else self.cookie_secure

    @property
    def effective_database_url(self) -> str:
        if self.database_url:
            url = self.database_url
            if url.startswith("postgres://"):  # Heroku-style
                url = "postgresql+psycopg://" + url[len("postgres://"):]
            elif url.startswith("postgresql://"):
                url = "postgresql+psycopg://" + url[len("postgresql://"):]
            return url
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{(self.data_dir / 'neurolens.db').as_posix()}"

    def resolve_secrets(self) -> None:
        """Make sure we have a signing secret. Production must provide one explicitly."""
        if self.secret_key and len(self.secret_key) >= 32:
            return
        if self.is_production:
            raise RuntimeError(
                "SECRET_KEY must be set (>= 32 chars) when NEUROLENS_ENV=production. "
                "Generate one with: python -c \"import secrets;print(secrets.token_urlsafe(48))\""
            )
        # Development / test: persist a random key so restarts do not log everyone out.
        self.data_dir.mkdir(parents=True, exist_ok=True)
        key_file = self.data_dir / ".dev_secret_key"
        if key_file.exists():
            self.secret_key = key_file.read_text().strip()
        else:
            self.secret_key = secrets.token_urlsafe(48)
            key_file.write_text(self.secret_key)
            log.warning("Generated a development SECRET_KEY at %s (do not use in production).", key_file)

    def validate_for_production(self) -> List[str]:
        problems: List[str] = []
        if not self.is_production:
            return problems
        if "*" in self.cors_origins:
            problems.append("CORS_ORIGINS must not contain '*' in production")
        if not self.effective_cookie_secure:
            problems.append("cookies must be Secure in production")
        if self.frontend_url.startswith("http://localhost"):
            problems.append("FRONTEND_URL still points to localhost")
        return problems


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.resolve_secrets()
    problems = s.validate_for_production()
    if problems:
        raise RuntimeError("Insecure production configuration: " + "; ".join(problems))
    return s


def reset_settings_cache() -> None:
    get_settings.cache_clear()
