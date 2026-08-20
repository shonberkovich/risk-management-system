from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Deployment environment ---
    # "development" (default, local course laptop) | "staging" | "production". Nothing reads
    # this to change business logic — its only job today is to drive the force_https default
    # below, so a production deployment gets HTTPS enforcement without a human remembering to
    # also set FORCE_HTTPS=true. Add more environment-derived defaults here if they come up.
    environment: str = "development"

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
    # non-local deployment — see .env.example.
    jwt_secret_key: str = "dev-insecure-secret-change-me"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_days: int = 14
    # Key rotation: comma-separated *previous* signing keys, still accepted to verify tokens
    # that were issued before a rotation but haven't expired yet (refresh tokens live up to
    # jwt_refresh_token_expire_days). Never used to *sign* new tokens — only jwt_secret_key is.
    # Rotation procedure: move the current JWT_SECRET_KEY value to the front of
    # JWT_PREVIOUS_SECRET_KEYS, set JWT_SECRET_KEY to a newly generated value, deploy. Once
    # jwt_refresh_token_expire_days has passed, the old key can be dropped from the list.
    jwt_previous_secret_keys: str = ""

    # --- Field-level encryption at rest (services/encryption.py) ---
    # Fernet key (32 url-safe base64 bytes, e.g. `python -c "from cryptography.fernet import
    # Fernet; print(Fernet.generate_key().decode())"`). Dev-only fallback below; MUST be
    # overridden in .env for any environment holding real data, and never rotated without a
    # re-encryption migration (rotating it makes existing ciphertext unreadable).
    field_encryption_key: str = "6mQhq3zR6d6dq2pQwq2b9b8fJqk3wq2b9b8fJqk3wq0="
    # Key rotation: comma-separated *previous* Fernet keys. services/encryption.py builds a
    # `cryptography.fernet.MultiFernet` from [field_encryption_key, *field_encryption_key_previous]
    # — new writes always encrypt with field_encryption_key (the first key), but reads try every
    # key in the list in order, so ciphertext written under an old key stays readable without a
    # backfill migration. Rotation procedure: move the current FIELD_ENCRYPTION_KEY value to the
    # front of FIELD_ENCRYPTION_KEY_PREVIOUS, set FIELD_ENCRYPTION_KEY to a newly generated key,
    # deploy. Optionally re-encrypt existing rows under the new key over time (read + re-save
    # each row — MultiFernet.rotate does this per-value); once every row has been re-saved, drop
    # the old key from the list. Until then, keep it — dropping it early makes old rows
    # unreadable, the same one-way risk already noted above for a bare rotation.
    field_encryption_key_previous: str = ""

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
    # When true, a middleware (see main.py) redirects http:// requests to https://. Defaults to
    # False for local dev (uvicorn --reload, LocalDB has no TLS cert) but the model_validator
    # below flips it to True automatically whenever ENVIRONMENT=production and FORCE_HTTPS
    # wasn't itself set explicitly — "based on environment variables", so a production
    # deployment can't go live with this silently off just because nobody remembered the flag.
    # Explicitly setting FORCE_HTTPS always wins (e.g. force it False behind a proxy that
    # already terminates TLS upstream of this app). Must sit behind a real reverse proxy /
    # load balancer that terminates TLS and forwards X-Forwarded-Proto either way.
    force_https: bool = False

    # --- Notifications (services/notifications.py) ---
    # Real Email/SMS/Push delivery is out of scope for this course demo (no SendGrid/Twilio/
    # FCM account, no credentials to put here) — dispatch is always simulated (logged, not
    # actually sent), see notifications.py module docstring. This flag doesn't toggle "real vs
    # simulated" (there's only ever simulated); it's an operational kill-switch so the dispatch
    # endpoint can be turned off (e.g. during a demo, or if alert volume is noisy) without
    # touching code, the same graceful-degradation shape as sso_enabled and the ANTHROPIC_API_KEY
    # check in routers/ai.py — degrade to a clean 503 rather than silently no-op.
    notifications_enabled: bool = True

    @model_validator(mode="after")
    def _default_force_https_in_production(self) -> "Settings":
        if self.environment == "production" and "force_https" not in self.model_fields_set:
            self.force_https = True
        return self

    @property
    def jwt_previous_secret_keys_list(self) -> list[str]:
        """`jwt_previous_secret_keys` split on commas, blanks dropped — the list
        `services/auth.py` tries (in order, after the current key) to verify a token."""
        return [k.strip() for k in self.jwt_previous_secret_keys.split(",") if k.strip()]

    @property
    def field_encryption_key_previous_list(self) -> list[str]:
        """`field_encryption_key_previous` split on commas, blanks dropped — the extra keys
        `services/encryption.py` folds into its `MultiFernet` for key-rotation support."""
        return [k.strip() for k in self.field_encryption_key_previous.split(",") if k.strip()]


settings = Settings()
