from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_db: str = "returnlens"

    jwt_secret: str = "dev-only-secret-change-me"
    jwt_expire_minutes: int = 60 * 24 * 7

    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"
    llm_timeout_seconds: int = 60

    frontend_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    max_upload_mb: int = 15
    # Run analysis jobs inside the request instead of the background worker (used by tests).
    analysis_inline: bool = False
    # Daily check: re-verifies completed fixes and refreshes alerts in every workspace.
    monitor_enabled: bool = True
    monitor_interval_minutes: int = 60

    log_level: str = "INFO"

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.frontend_origins.split(",") if o.strip()]

    @property
    def llm_enabled(self) -> bool:
        return bool(self.groq_api_key.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
