"""TODO_SPEC.md task 13 step 4 — the in-process poller that actually "sends"
scheduled emails once their `scheduled_for` time arrives.

Design choice — option (a) from the task brief: a simple `asyncio` background
task, started from FastAPI's lifespan, that wakes up every
`POLL_INTERVAL_SECONDS` and asks `services.email.process_due_scheduled_emails`
what's due, rather than option (b) (`BackgroundTasks` + one `asyncio.sleep(delay)`
per email, scheduled at creation time). Reasoning:

- (b) loses every still-pending scheduled email the moment this dev process
  restarts — and per CLAUDE.md's own documented gotcha, `uvicorn --reload`
  restarting (or a developer just stopping/starting the server) is routine on
  this stack. Nothing would re-arm the `asyncio.sleep()` call for an email
  that was already `SCHEDULED` before the restart, so it would simply never
  send. (a)'s poller re-derives "what's due" straight from the DB on every
  tick, so a restart just means the next tick (at most
  `POLL_INTERVAL_SECONDS` later) picks up anything that became due while the
  process was down — no separate recovery/reschedule bookkeeping needed. This
  is the deciding factor and is almost certainly why the task brief calls it
  out as the more robust option.
- (a) also bounds how much this one process has to track at any moment (one
  query + however many rows are actually due right now) instead of (b), which
  would hold one live `asyncio.sleep()` task per still-pending scheduled
  email for as long as it's scheduled out (hours or days), all lost on any
  restart with no persistence at all.
- The trade-off is coarser precision — an email can fire up to
  `POLL_INTERVAL_SECONDS` late. Acceptable for this course demo; a real
  system would reach for a durable job queue (Celery/RQ + a broker), which
  CLAUDE.md explicitly rules out for this stack ("no Celery/Redis... do not
  add them").

Not started at all while running under pytest — see `_running_under_pytest`.
Tests exercise the actual send-on-due logic directly via
`process_due_scheduled_emails` against their own in-memory SQLite session
(see that function's docstring for why it's factored out precisely so this is
possible); the real poller below opens its own `SessionLocal()` bound to the
real SQL Server engine configured in `app/database.py`, which the test
fixtures never touch (they override the FastAPI `get_db` dependency and
`AuditLogMiddleware`'s session instead — see tests/conftest.py). Leaving the
poller enabled during tests would mean every test that spins up a
`TestClient` (which runs FastAPI's lifespan) also starts a background task
hitting a real/unreachable SQL Server connection on a timer for the lifetime
of that test's `client` fixture — unnecessary I/O and noise this app doesn't
need in CI, and a hazard on a machine with no LocalDB configured at all.
"""
from __future__ import annotations

import asyncio
import logging
import sys

from app.database import SessionLocal
from app.services.email import process_due_scheduled_emails

logger = logging.getLogger(__name__)

# How often the poller wakes up to check for due scheduled emails. See module
# docstring for the precision/robustness trade-off this implies.
POLL_INTERVAL_SECONDS = 30


def _running_under_pytest() -> bool:
    """True whenever this process was launched by pytest — `pytest` only ever
    ends up in `sys.modules` if it (or something that imports it, i.e. the
    test runner itself) has actually been imported, which happens exactly
    when the app is loaded from within a pytest run (see module docstring for
    why the poller must not start in that case)."""
    return "pytest" in sys.modules


async def _poll_loop() -> None:
    """Runs forever (until cancelled by the lifespan shutdown below), sleeping
    `POLL_INTERVAL_SECONDS` between ticks. Each tick opens and closes its own
    short-lived Session — mirrors the per-request `get_db` pattern in
    app/database.py, just without a FastAPI request driving it. A single
    tick's exception (e.g. a transient DB connectivity blip) is logged and
    swallowed rather than killing the loop — the next tick tries again."""
    while True:
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
        db = SessionLocal()
        try:
            sent = process_due_scheduled_emails(db)
            if sent:
                logger.info("scheduled-email poller: sent %d due email(s)", len(sent))
        except Exception:
            logger.exception("scheduled-email poller: error while processing due scheduled emails")
        finally:
            db.close()


def start_scheduled_email_poller() -> asyncio.Task[None] | None:
    """Called once from app/main.py's lifespan startup. Returns the created
    `asyncio.Task` (so lifespan shutdown can cancel it cleanly), or `None` if
    the poller was skipped entirely (under pytest — see
    `_running_under_pytest`), in which case there is nothing to cancel."""
    if _running_under_pytest():
        return None
    return asyncio.create_task(_poll_loop())
