"""Simple in-memory rate limiter for the AI endpoints (routers/ai.py).

Deliberately minimal for this course project: a fixed-window counter keyed by
caller identity, held in a process-local dict. No Redis/external store — RMIS runs
as a single uvicorn process for the demo (see CLAUDE.md: RBAC/auth enforcement
is out of scope here), so this is scoped to "protect the Anthropic API key
from being hammered by one client", not to be a production-grade limiter.

Keying: `routers/ai.py` requires authentication (`require_roles()`) on every route in
this router, so the caller normally carries a valid JWT — we key the bucket off that
user's id (decoded straight from the bearer token, without hitting the DB; a full
validity/active check is still done downstream by `get_current_user`). This used to key
off `request.client.host` alone, which is wrong on two counts: (1) it's a single shared
bucket across *all* users when the app sits behind a reverse proxy (every request's
immediate peer is the proxy, so every user collapsed into one counter — one busy user
could 429 everyone else), and (2) it ignored the authenticated identity entirely, so two
different users sharing a NAT/proxy IP would also share a bucket. When no usable token is
present (shouldn't normally happen given the router's auth dependency, but keep a
fallback for safety/tests), we fall back to the real client IP taken from
`X-Forwarded-For` (first hop in that header — the original client, not the proxy), and
only fall back to `request.client.host` if that header is absent.

Window resets every `settings.ai_rate_limit_window_seconds` seconds; each
client (user or IP) gets at most `settings.ai_rate_limit_per_window` requests to any
/api/ai/* route within that window before getting a 429.
"""
import time
from collections import defaultdict

from fastapi import HTTPException, Request

from app.config import settings
from app.services.auth import TokenError, decode_token

# key -> (window_start_epoch_seconds, request_count_in_window)
_counters: dict[str, tuple[float, int]] = defaultdict(lambda: (0.0, 0))


def _client_key(request: Request) -> str:
    """Prefer the authenticated user's id (from the bearer token) so rate limiting is
    per-user; fall back to the real client IP (X-Forwarded-For, first hop) when there's
    no usable token, and to request.client.host as a last resort."""
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
        try:
            payload = decode_token(token, expected_type="access")
            user_id = payload["sub"]
            return f"user:{user_id}"
        except (TokenError, KeyError, ValueError):
            pass  # invalid/expired token — fall through to IP-based keying

    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        first_ip = forwarded_for.split(",")[0].strip()
        if first_ip:
            return f"ip:{first_ip}"

    return f"ip:{request.client.host if request.client else 'unknown'}"


def enforce_ai_rate_limit(request: Request) -> None:
    """FastAPI dependency — raises 429 once a client exceeds the AI rate limit."""
    key = _client_key(request)
    now = time.monotonic()
    window_start, count = _counters[key]

    if now - window_start >= settings.ai_rate_limit_window_seconds:
        # window has elapsed — start a fresh one
        window_start, count = now, 0

    count += 1
    _counters[key] = (window_start, count)

    if count > settings.ai_rate_limit_per_window:
        retry_after = max(0, int(settings.ai_rate_limit_window_seconds - (now - window_start)))
        raise HTTPException(
            429,
            f"חריגה ממכסת הבקשות ל-AI ({settings.ai_rate_limit_per_window} בקשות ל-{settings.ai_rate_limit_window_seconds} שניות). נסה שוב בעוד {retry_after} שניות.",
            headers={"Retry-After": str(retry_after)},
        )
