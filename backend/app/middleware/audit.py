"""Automatic Audit_Log writes for every state-changing request.

Wraps mutating HTTP verbs (POST/PUT/PATCH/DELETE) — GETs are read-only and never
audited. Best-effort `entity_type`/`entity_id` extraction comes from the URL path
(`/api/{entity_type}/{entity_id}...`), matching the same generic entity-type vocabulary
`documents.py` already uses (INCIDENT/CLAIM/PROPERTY/POLICY/...). The caller's identity
comes from the same JWT access token `dependencies.permissions.get_current_user` reads —
decoded independently here (middleware runs outside the dependency-injection graph) so
audit rows still record `user_id: NULL` for anonymous/failed-auth requests rather than
raising.

Runs *after* the endpoint (in the `finally`), so `new_value` reflects the actual response
body (what was persisted / the error returned), and the audited action is skipped
entirely for requests that never reach a matching route (404s before routing).

TODO_SPEC.md "משימה 20" step 1 — auditing two specific email actions:

  * "הורדת צרופה רגישה" (downloading a sensitive attachment) — GET
    /api/emails/attachments/{id}/signed-url (routers/emails.py's
    get_attachment_signed_url, Task 6). This is a read, not one of the
    _MUTATING_METHODS above, so the generic mutating-verb sweep never sees it at
    all — but it's exactly the kind of action this task calls out for auditing, so
    `_AUDITED_GET_ROUTES` below is a small, explicit, named allowlist of GET
    routes audited *in addition to* every mutating request, kept in this same
    middleware (the one existing mechanism every audit row already goes through)
    rather than a second, parallel `AuditLog(...)` call added inside
    routers/emails.py. Every other GET in the app is still never audited — this
    is a narrow, deliberate exception, not a policy change. Per TODO_SPEC.md step
    5's privacy concern, only metadata is recorded (who downloaded which
    attachment_id, when, from what IP) — a GET has no request body to log, so
    `new_value` is always None here; the attachment's file bytes/content are
    never read or stored by this middleware.

  * "מחיקת מייל לצמיתות" (permanently deleting an email from Trash) — checked for
    and *not* wired up: this codebase has no permanent-delete endpoint for an
    email anywhere (`services/email.py`'s trash_email only moves a message to the
    TRASH folder via the same generic PATCH /{id}/folder every other folder move
    uses; there is no DELETE that actually removes an Email/Email_Recipients row
    for a received/sent message — the one real `db.delete(Email)` in that module,
    `cancel_scheduled_email`, is for an unsent *scheduled* message and is a
    different feature entirely). That PATCH move-to-TRASH and the real
    cancel-schedule DELETE are both already audited for free by the generic
    mutating-verb sweep above (PATCH -> UPDATE, DELETE -> DELETE) — nothing
    further to add here. Inventing a new hard-delete-from-Trash feature just to
    have something to audit was explicitly out of scope for this task.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app import models
from app.database import SessionLocal
from app.services.auth import TokenError, decode_token

_MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_ACTION_BY_METHOD = {"POST": "CREATE", "PUT": "UPDATE", "PATCH": "UPDATE", "DELETE": "DELETE"}

# /api/<entity_type>/<entity_id>[...]  — covers /api/claims/12/payments,
# /api/documents/entity/PROPERTY/3, /api/mitigation-tasks/7, etc. well enough for an
# audit trail (best-effort, not a router).
_PATH_RE = re.compile(r"^/api/([a-zA-Z\-]+?)(?:/(\d+))?(?:/.*)?$")

# TODO_SPEC.md "משימה 20" step 1 — named GET routes audited despite being reads (see
# module docstring above). Each entry is (path pattern with the id as capture group
# 1, entity_type, action); matched only for method == "GET". Keep this list short and
# deliberate — it's a named exception list, not a general "audit every read" switch.
_AUDITED_GET_ROUTES: list[tuple[re.Pattern, str, str]] = [
    (re.compile(r"^/api/emails/attachments/(\d+)/signed-url$"), "EMAIL_ATTACHMENT", "DOWNLOAD"),
]


def _extract_entity(path: str) -> tuple[str, int]:
    match = _PATH_RE.match(path)
    if not match:
        return path, 0
    entity_type, entity_id = match.group(1), match.group(2)
    return entity_type.upper(), int(entity_id) if entity_id else 0


def _current_user_id(request: Request) -> int | None:
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        return None
    try:
        payload = decode_token(auth_header[7:], expected_type="access")
    except TokenError:
        return None
    return int(payload["sub"])


def _match_audited_get(path: str) -> tuple[str, str, int] | None:
    """Checks `path` against `_AUDITED_GET_ROUTES` — returns (entity_type, action,
    entity_id) for the first match, or None. See module docstring."""
    for pattern, entity_type, action in _AUDITED_GET_ROUTES:
        match = pattern.match(path)
        if match:
            return entity_type, action, int(match.group(1))
    return None


class AuditLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        is_mutating = request.method in _MUTATING_METHODS
        audited_get = (
            _match_audited_get(request.url.path) if request.method == "GET" else None
        )
        if not request.url.path.startswith("/api/") or not (is_mutating or audited_get):
            return await call_next(request)

        # Read the request body up front (Starlette caches it, so the endpoint can still
        # read it downstream) — used as old/new value context for the audit row. A GET
        # has no body to read (and nothing to log as new_value — see module docstring's
        # metadata-only note for the audited-GET case).
        body_bytes = await request.body() if is_mutating else b""
        response = await call_next(request)

        if audited_get is not None:
            entity_type, action, entity_id = audited_get
        else:
            entity_type, entity_id = _extract_entity(request.url.path)
            action = _ACTION_BY_METHOD[request.method]
        user_id = _current_user_id(request)
        try:
            new_value = body_bytes.decode("utf-8")[:2000] if body_bytes else None
        except UnicodeDecodeError:
            new_value = None

        db = SessionLocal()
        try:
            db.add(
                models.AuditLog(
                    user_id=user_id,
                    entity_type=entity_type,
                    entity_id=entity_id,
                    action=action,
                    old_value=None,
                    new_value=new_value,
                    timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
                    ip_address=request.client.host if request.client else None,
                )
            )
            db.commit()
        except Exception:
            # Audit logging must never break the actual request — swallow and move on.
            db.rollback()
        finally:
            db.close()

        return response
