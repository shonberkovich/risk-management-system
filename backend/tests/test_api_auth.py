"""Tests for routers/auth.py — login, refresh, logout, /me, and the SSO stub
endpoints. Covers the auth-abuse edge cases (wrong password, unknown email,
deactivated user, token-type confusion, SQL-injection-shaped input) as well
as SSO's graceful-degradation-to-501 behavior when SSO_ENABLED is unset.
"""
from __future__ import annotations

import pytest

from app import models
from app.config import settings
from app.services.auth import create_access_token, create_refresh_token
from tests.conftest import auth_headers

DEMO_PASSWORD = "Demo1234!"


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------


def test_login_happy_path(client, make_user):
    make_user(email="user@example.com")
    resp = client.post("/api/auth/login", json={"email": "user@example.com", "password": DEMO_PASSWORD})
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"] and body["refresh_token"]
    assert body["user"]["role"] == "ADMIN"


def test_login_wrong_password_is_401(client, make_user):
    make_user(email="user@example.com")
    resp = client.post("/api/auth/login", json={"email": "user@example.com", "password": "wrong-password"})
    assert resp.status_code == 401


def test_login_unknown_email_is_401_same_message_as_wrong_password(client, make_user):
    """Must not leak whether an email exists in the system — an unknown email
    and a wrong password for a real account should be indistinguishable to
    the caller (same status code, same generic message)."""
    make_user(email="real-user@example.com")
    known_resp = client.post(
        "/api/auth/login", json={"email": "real-user@example.com", "password": "wrong"}
    )
    unknown_resp = client.post(
        "/api/auth/login", json={"email": "nobody-at-all@example.com", "password": "wrong"}
    )
    assert known_resp.status_code == unknown_resp.status_code == 401
    assert known_resp.json()["detail"] == unknown_resp.json()["detail"]


def test_login_deactivated_user_is_401(client, make_user):
    make_user(email="inactive@example.com", is_active=False)
    resp = client.post("/api/auth/login", json={"email": "inactive@example.com", "password": DEMO_PASSWORD})
    assert resp.status_code == 401
    assert "הושבת" in resp.json()["detail"]


def test_login_rejects_sql_injection_shaped_email(client, make_user):
    """A parameterized query means this is just "no such user" — proving it
    404s/401s cleanly rather than 500ing (or, worst case, matching a row) is
    the actual regression guard here."""
    make_user(email="user@example.com")
    resp = client.post(
        "/api/auth/login",
        json={"email": "' OR '1'='1", "password": "' OR '1'='1"},
    )
    assert resp.status_code == 401


def test_login_rejects_missing_fields(client):
    assert client.post("/api/auth/login", json={"email": "a@b.com"}).status_code == 422
    assert client.post("/api/auth/login", json={"password": "x"}).status_code == 422
    assert client.post("/api/auth/login", json={}).status_code == 422


def test_login_handles_extremely_long_password_gracefully(client, make_user):
    """A pathologically long password shouldn't 500 the bcrypt/passlib verify
    call — must still resolve to a clean 401."""
    make_user(email="user@example.com")
    resp = client.post(
        "/api/auth/login", json={"email": "user@example.com", "password": "x" * 10_000}
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Refresh
# ---------------------------------------------------------------------------


def test_refresh_happy_path(client, make_user):
    user = make_user()
    refresh_token = create_refresh_token(user.user_id, user.role)
    resp = client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
    assert resp.status_code == 200
    assert resp.json()["access_token"]


def test_refresh_rejects_malformed_token(client):
    resp = client.post("/api/auth/refresh", json={"refresh_token": "not-a-real-jwt"})
    assert resp.status_code == 401


def test_refresh_rejects_access_token_used_as_refresh_token(client, make_user):
    """Token-type confusion: an access token must not work where a refresh
    token is expected, even though both are valid JWTs signed by this app."""
    user = make_user()
    access_token = create_access_token(user.user_id, user.role)
    resp = client.post("/api/auth/refresh", json={"refresh_token": access_token})
    assert resp.status_code == 401


def test_refresh_rejects_token_for_deleted_user(client, make_user, db):
    user = make_user()
    refresh_token = create_refresh_token(user.user_id, user.role)
    db.delete(user)
    db.commit()

    resp = client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
    assert resp.status_code == 401
    assert "לא נמצא" in resp.json()["detail"]


def test_refresh_rejects_token_for_deactivated_user(client, make_user, db):
    user = make_user()
    refresh_token = create_refresh_token(user.user_id, user.role)
    user.is_active = False
    db.commit()

    resp = client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
    assert resp.status_code == 401
    assert "הושבת" in resp.json()["detail"]


def test_refresh_rejects_missing_body(client):
    assert client.post("/api/auth/refresh", json={}).status_code == 422


# ---------------------------------------------------------------------------
# Logout / me
# ---------------------------------------------------------------------------


def test_logout_requires_auth(client):
    assert client.post("/api/auth/logout").status_code == 401


def test_logout_happy_path(client, make_user):
    user = make_user()
    resp = client.post("/api/auth/logout", headers=auth_headers(user))
    assert resp.status_code == 204


def test_me_requires_auth(client):
    assert client.get("/api/auth/me").status_code == 401


def test_me_returns_current_user(client, make_user):
    user = make_user(full_name="בודק בדיקות")
    resp = client.get("/api/auth/me", headers=auth_headers(user))
    assert resp.status_code == 200
    body = resp.json()
    assert body["user_id"] == user.user_id
    assert body["full_name"] == "בודק בדיקות"


def test_me_rejects_tampered_token(client):
    resp = client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-real-jwt"})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# SSO stub — graceful degradation when SSO_ENABLED is unset (the default)
# ---------------------------------------------------------------------------


def test_sso_login_returns_501_when_disabled(client, monkeypatch):
    monkeypatch.setattr(settings, "sso_enabled", False)
    resp = client.get("/api/auth/sso/azure-ad/login")
    assert resp.status_code == 501


def test_sso_callback_returns_501_when_disabled(client, monkeypatch):
    monkeypatch.setattr(settings, "sso_enabled", False)
    resp = client.post("/api/auth/sso/azure-ad/callback", params={"code": "irrelevant"})
    assert resp.status_code == 501


def test_sso_login_rejects_unknown_provider_when_enabled(client, monkeypatch):
    monkeypatch.setattr(settings, "sso_enabled", True)
    monkeypatch.setattr(settings, "sso_provider", "azure-ad")
    resp = client.get("/api/auth/sso/some-other-provider/login")
    assert resp.status_code == 404


def test_sso_login_builds_authorize_url_when_enabled(client, monkeypatch):
    monkeypatch.setattr(settings, "sso_enabled", True)
    monkeypatch.setattr(settings, "sso_provider", "azure-ad")
    monkeypatch.setattr(settings, "sso_client_id", "test-client-id")
    monkeypatch.setattr(settings, "sso_authorize_url", "https://idp.example.com/authorize")
    resp = client.get("/api/auth/sso/azure-ad/login")
    assert resp.status_code == 200
    assert resp.json()["authorize_url"].startswith("https://idp.example.com/authorize?")
    assert "test-client-id" in resp.json()["authorize_url"]


def test_sso_callback_still_501s_even_when_enabled(client, monkeypatch):
    """The callback's real code-exchange logic is genuinely unimplemented (no
    live IdP to test against, per the module docstring) — it must 501 even
    with SSO_ENABLED=true, not fall through to a 500 or a silent no-op success."""
    monkeypatch.setattr(settings, "sso_enabled", True)
    monkeypatch.setattr(settings, "sso_provider", "azure-ad")
    resp = client.post("/api/auth/sso/azure-ad/callback", params={"code": "some-code"})
    assert resp.status_code == 501


def test_sso_callback_requires_code_param(client, monkeypatch):
    monkeypatch.setattr(settings, "sso_enabled", False)
    resp = client.post("/api/auth/sso/azure-ad/callback")
    assert resp.status_code == 422
