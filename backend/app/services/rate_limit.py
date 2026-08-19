"""Simple in-memory rate limiter for the AI endpoints (routers/ai.py).

Deliberately minimal for this course project: a fixed-window counter keyed by
client IP, held in a process-local dict. No Redis/external store — RMIS runs
as a single uvicorn process for the demo (see CLAUDE.md: RBAC/auth enforcement
is out of scope here), so this is scoped to "protect the Anthropic API key
from being hammered by one client", not to be a production-grade limiter.

Window resets every `settings.ai_rate_limit_window_seconds` seconds; each
client IP gets at most `settings.ai_rate_limit_per_window` requests to any
/api/ai/* route within that window before getting a 429.
"""
import time
from collections import defaultdict

from fastapi import HTTPException, Request

from app.config import settings

# ip -> (window_start_epoch_seconds, request_count_in_window)
_counters: dict[str, tuple[float, int]] = defaultdict(lambda: (0.0, 0))


def _client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


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
