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

    # --- Auth / JWT (services/auth.py, dependencies/permissions.py) ---
    # Dev-only fallback secret. MUST be overridden via JWT_SECRET_KEY in .env for any
    # non-local deployment — see .env.example. Rotating it invalidates all outstanding tokens.
    jwt_secret_key: str = "dev-insecure-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_days: int = 14

    # --- Field-level encryption at rest (services/encryption.py) ---
    # Fernet key (32 url-safe base64 bytes, e.g. `python -c "from cryptography.fernet import
    # Fernet; print(Fernet.generate_key().decode())"`). Dev-only fallback below; MUST be
    # overridden in .env for any environment holding real data, and never rotated without a
    # re-encryption migration (rotating it makes existing ciphertext unreadable).
    field_encryption_key: str = "6mQhq3zR6d6dq2pQwq2b9b8fJqk3wq2b9b8fJqk3wq0="

    # --- SSO / enterprise identity (routers/auth.py) ---
    # Left blank by default: /api/auth/sso/{provider}/login degrades to a clean 501, the same
    # graceful-degradation convention used by the /api/ai/* endpoints when ANTHROPIC_API_KEY is
    # unset. Fill these in to point at a real OAuth2/OIDC IdP (Azure AD / Okta / etc.).
    sso_enabled: bool = False
    sso_provider: str = "azure-ad"
    sso_client_id: str = ""
    sso_client_secret: str = ""
    sso_authorize_url: str = ""
    sso_token_url: str = ""
    sso_redirect_uri: str = "http://localhost:5173/auth/sso/callback"

    # --- Transport security ---
    # When true, a middleware (see main.py) redirects http:// requests to https://. Left off by
    # default because local dev (uvicorn --reload, LocalDB) has no TLS cert; set true behind a
    # real reverse proxy / load balancer that terminates TLS.
    force_https: bool = False


settings = Settings()
