"""Login / token refresh / current-user / SSO stub.

Stateless-JWT auth: `/login` issues a short-lived access token + longer-lived refresh
token; `/refresh` exchanges a refresh token for a new access token; `/me` returns the
caller identified by the access token. There is no server-side revocation list, so
`/logout` is a no-op that exists purely so the frontend has a symmetric endpoint to call
when it drops its locally-stored tokens — a real deployment wanting immediate
server-side revocation would need a token blacklist/short-TTL session store, which is
out of scope for this course demo (documented in TODO_SPEC.md).

SSO endpoints follow the same graceful-degradation convention as `/api/ai/*` when
`ANTHROPIC_API_KEY` is unset: with `SSO_ENABLED=false` (the default — no real IdP
available in this environment) they return a clean 501 instead of pretending to work.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.config import settings
from app.database import get_db
from app.dependencies.permissions import get_current_user
from app.services.auth import (
    TokenError,
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=schemas.TokenPair)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(models.User).where(models.User.email == payload.email))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="אימייל או סיסמה שגויים")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="המשתמש הושבת")
    return schemas.TokenPair(
        access_token=create_access_token(user.user_id, user.role),
        refresh_token=create_refresh_token(user.user_id, user.role),
        user=user,
    )


@router.post("/refresh", response_model=schemas.AccessToken)
def refresh(payload: schemas.RefreshRequest, db: Session = Depends(get_db)):
    try:
        claims = decode_token(payload.refresh_token, expected_type="refresh")
    except TokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="טוקן רענון לא תקף או פג תוקף")
    user = db.scalar(select(models.User).where(models.User.user_id == int(claims["sub"])))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="משתמש לא נמצא")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="המשתמש הושבת")
    return schemas.AccessToken(access_token=create_access_token(user.user_id, user.role))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(_user: models.User = Depends(get_current_user)):
    # Stateless JWTs: nothing to invalidate server-side. See module docstring.
    return None


@router.get("/me", response_model=schemas.UserOut)
def me(user: models.User = Depends(get_current_user)):
    return user


@router.get("/sso/{provider}/login")
def sso_login(provider: str):
    if not settings.sso_enabled:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=(
                f"התחברות SSO ({provider}) אינה מוגדרת בסביבה זו. "
                "יש להגדיר SSO_ENABLED=true ואת פרטי ה-IdP ב-.env כדי להפעיל."
            ),
        )
    if provider != settings.sso_provider:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"ספק לא מוכר: {provider}")
    # OAuth2 authorization-code flow, skeleton only — no live IdP in this environment.
    query = (
        f"client_id={settings.sso_client_id}"
        f"&redirect_uri={settings.sso_redirect_uri}"
        "&response_type=code&scope=openid+profile+email"
    )
    return {"authorize_url": f"{settings.sso_authorize_url}?{query}"}


@router.post("/sso/{provider}/callback")
def sso_callback(provider: str, code: str):
    if not settings.sso_enabled:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=f"התחברות SSO ({provider}) אינה מוגדרת בסביבה זו.",
        )
    # Exchanging `code` for a token at settings.sso_token_url and mapping the returned
    # identity to a local User row would go here; not implemented (no IdP to test against).
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="חילופי קוד SSO טרם מומשו")
