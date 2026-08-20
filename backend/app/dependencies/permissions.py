"""FastAPI dependencies for authentication and role-based access control (RBAC).

`get_current_user` decodes the `Authorization: Bearer <access-token>` header and loads
the matching `models.User` row; it's the single source of truth for "who is calling".

`require_roles(*roles)` builds a dependency that additionally checks the caller's role
is one of `roles` (403 if not). Calling it with no roles (`require_roles()`) is
"authenticated, any role" — used on endpoints that should be logged-in-gated but aren't
role-restricted.

Applied across `routers/*.py` on all state-changing endpoints (POST/PUT/PATCH/DELETE),
and most GET/read endpoints are intentionally left open so dashboards keep working
before a caller has signed in — see the "מודול אימות משתמשים" write-up in
TODO_SPEC.md for the rationale. **Exception:** GET endpoints whose payload is
financial disclosure (KPIs, cashflow, exposure, policies — see `routers/analytics.py`'s
`_FINANCIAL_READ_ROLES` and `routers/policies.py`'s `_POLICIES_READ_ROLES`) are gated
too, closing off FIELD_WORKER and any unauthenticated caller from that data
specifically (TODO_SPEC.md §3, "אכיפת RBAC על בקשות ה-GET").
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.services.auth import TokenError, decode_token

_bearer_scheme = HTTPBearer(auto_error=False)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="נדרשת התחברות (Authorization: Bearer <token>)",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    if credentials is None:
        raise _UNAUTHORIZED
    try:
        payload = decode_token(credentials.credentials, expected_type="access")
    except TokenError:
        raise _UNAUTHORIZED
    user = db.scalar(select(models.User).where(models.User.user_id == int(payload["sub"])))
    if user is None or not user.is_active:
        # A disabled user's already-issued access token is rejected here too — not
        # just future logins — so disabling (routers/users.py) takes effect
        # immediately instead of waiting for the token to expire on its own.
        raise _UNAUTHORIZED
    return user


def require_roles(*roles: str):
    """Dependency factory. `require_roles()` (no args) = authenticated, any role.
    `require_roles("ADMIN", "RISK_MANAGER")` = authenticated AND role in that set."""

    def _check(user: models.User = Depends(get_current_user)) -> models.User:
        if roles and user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"תפקיד '{user.role}' אינו מורשה לפעולה זו",
            )
        return user

    return _check
