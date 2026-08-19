from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    db_server: str = r"(localdb)\MSSQLLocalDB"
    db_name: str = "RiskDB"
    db_driver: str = "ODBC Driver 17 for SQL Server"

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-opus-5"

    # AI rate limiting (services/rate_limit.py) — protects the Anthropic API key
    # from being hammered by a single client; see routers/ai.py.
    ai_rate_limit_per_window: int = 10
    ai_rate_limit_window_seconds: int = 60

    cors_origins: list[str] = ["http://localhost:5173"]


settings = Settings()
