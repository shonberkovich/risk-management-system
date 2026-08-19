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


class AuditLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method not in _MUTATING_METHODS or not request.url.path.startswith("/api/"):
            return await call_next(request)

        # Read the request body up front (Starlette caches it, so the endpoint can still
        # read it downstream) — used as old/new value context for the audit row.
        body_bytes = await request.body()
        response = await call_next(request)

        entity_type, entity_id = _extract_entity(request.url.path)
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
                    action=_ACTION_BY_METHOD[request.method],
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
