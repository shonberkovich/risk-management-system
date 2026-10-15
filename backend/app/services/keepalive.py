"""Daytime keep-alive heartbeat for the free Render deployment (see render.yaml).

Render spins a free web service down after 15 minutes without inbound traffic, and
the first request after that waits ~1 minute for a cold start. While the server is
up, this loop GETs its own public /api/health every `keepalive_interval_seconds` —
through Render's proxy, so it counts as inbound traffic — but only between
`keepalive_start_hour` and `keepalive_end_hour` in `keepalive_timezone`. Outside
those hours it stays quiet and the service is allowed to sleep, which saves free
instance hours. Waking it back up in the morning is the job of the GitHub Actions
workflow in .github/workflows/keepalive.yml: a sleeping server can't ping itself.

/api/health never touches the database, so the heartbeat doesn't keep the Neon
database awake (its free tier counts active compute hours separately).
"""
from __future__ import annotations

import asyncio
import logging
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


def _base_url() -> str:
    return (settings.keepalive_url or settings.render_external_url).rstrip("/")


def in_active_hours(now: datetime | None = None) -> bool:
    now = now or datetime.now(ZoneInfo(settings.keepalive_timezone))
    return settings.keepalive_start_hour <= now.hour < settings.keepalive_end_hour


async def _heartbeat_loop(url: str) -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            await asyncio.sleep(settings.keepalive_interval_seconds)
            if not in_active_hours():
                continue
            try:
                await client.get(url)
            except Exception:
                logger.warning("keep-alive: heartbeat to %s failed", url, exc_info=True)


def start_keepalive() -> asyncio.Task[None] | None:
    """Called from app/main.py's lifespan. None (nothing to cancel) when no public
    URL is configured — i.e. local dev — or under pytest."""
    base = _base_url()
    if not base or "pytest" in sys.modules:
        return None
    return asyncio.create_task(_heartbeat_loop(f"{base}/api/health"))
