"""Password hashing and JWT issuing/verification for the auth module.

Password hashing uses stdlib `hashlib.pbkdf2_hmac` (no extra dependency, no native
build step — relevant on Windows/course laptops where something like bcrypt can need a
C toolchain) with a random per-password salt, stored as `"<salt_hex>$<hash_hex>"` in
`Users.password_hash`.

JWTs are signed with HS256 using `settings.jwt_secret_key`. Two token types are issued:
- access token (short-lived, `type: "access"`) — sent as `Authorization: Bearer <token>`
  on every request; verified by `dependencies/permissions.get_current_user`.
- refresh token (longer-lived, `type: "refresh"`) — exchanged at `POST /api/auth/refresh`
  for a new access token. There is no server-side revocation list (see routers/auth.py
  docstring on `/logout`); this is a stateless-JWT tradeoff acceptable for a course demo.

Key rotation: `decode_token` verifies against `settings.jwt_secret_key` first, then falls back
to each of `settings.jwt_previous_secret_keys_list` in order. Signing (`_create_token`) only
ever uses `jwt_secret_key` — rotating means moving the old key into the "previous" list and
picking a new current one (see config.py for the full procedure), so tokens issued before the
rotation keep verifying until they expire naturally instead of logging every user out at once.
"""
from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt

from app.config import settings

_PBKDF2_ITERATIONS = 260_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash or "$" not in password_hash:
        return False
    salt_hex, digest_hex = password_hash.split("$", 1)
    salt = bytes.fromhex(salt_hex)
    expected = bytes.fromhex(digest_hex)
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return hmac.compare_digest(expected, actual)


def _create_token(user_id: int, role: str, token_type: str, expires_delta: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "role": role,
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: int, role: str) -> str:
    return _create_token(
        user_id, role, "access", timedelta(minutes=settings.jwt_access_token_expire_minutes)
    )


def create_refresh_token(user_id: int, role: str) -> str:
    return _create_token(
        user_id, role, "refresh", timedelta(days=settings.jwt_refresh_token_expire_days)
    )


class TokenError(Exception):
    """Raised for any invalid/expired/wrong-type token; callers turn this into a 401."""


def decode_token(token: str, expected_type: str) -> dict:
    # Try the current signing key first (the common case), then each previous key in turn —
    # lets a rotated-out key keep verifying already-issued tokens. See module docstring.
    last_error: jwt.PyJWTError | None = None
    for key in (settings.jwt_secret_key, *settings.jwt_previous_secret_keys_list):
        try:
            payload = jwt.decode(token, key, algorithms=[settings.jwt_algorithm])
            break
        except jwt.PyJWTError as exc:
            last_error = exc
    else:
        raise TokenError(str(last_error))
    if payload.get("type") != expected_type:
        raise TokenError(f"expected a {expected_type} token, got {payload.get('type')!r}")
    return payload
