"""Integration tests for the auth/RBAC layer itself: login issuing a working bearer
token, /me, and require_roles()'s three-way behavior (no token -> 401, wrong role ->
403, right role -> 200) across a few representative endpoints. See TODO_SPEC.md stage
10 ("בדיקות אינטגרציה ל-API — הרשאות")."""
from tests.conftest import auth_headers


def test_login_with_correct_password_returns_working_token(client, make_user):
    user = make_user(role="ADMIN", email="admin-login-test@example.com")

    resp = client.post("/api/auth/login", json={"email": user.email, "password": "Demo1234!"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["role"] == "ADMIN"

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    assert me.json()["user_id"] == user.user_id  # UserOut deliberately omits email


def test_login_with_wrong_password_is_401(client, make_user):
    user = make_user(role="ADMIN", email="wrong-pw-test@example.com")
    resp = client.post("/api/auth/login", json={"email": user.email, "password": "not-the-password"})
    assert resp.status_code == 401


def test_login_with_unknown_email_is_401(client):
    resp = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "x"})
    assert resp.status_code == 401


def test_me_without_token_is_401(client):
    assert client.get("/api/auth/me").status_code == 401


def test_me_with_garbage_token_is_401(client):
    resp = client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert resp.status_code == 401


def test_refresh_token_issues_new_access_token(client, make_user):
    user = make_user(role="CFO", email="refresh-test@example.com")
    login = client.post("/api/auth/login", json={"email": user.email, "password": "Demo1234!"}).json()

    refreshed = client.post("/api/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert refreshed.status_code == 200
    assert "access_token" in refreshed.json()


def test_audit_log_is_admin_only(client, make_user):
    admin = make_user(role="ADMIN")
    non_admin = make_user(role="CFO")

    assert client.get("/api/audit-log").status_code == 401  # no token
    assert client.get("/api/audit-log", headers=auth_headers(non_admin)).status_code == 403
    assert client.get("/api/audit-log", headers=auth_headers(admin)).status_code == 200


def test_mitigation_task_write_requires_permitted_role(client, make_property, make_user):
    prop = make_property()
    field_worker = make_user(role="FIELD_WORKER")  # not in _MITIGATION_WRITE_ROLES
    property_manager = make_user(role="PROPERTY_MANAGER")  # is in _MITIGATION_WRITE_ROLES

    payload = {
        "property_id": prop.property_id,
        "title": "משימת בדיקה",
        "cost_estimate": 10000,
        "expected_annual_savings": 2000,
        "due_date": "2025-01-01",
    }

    assert client.post("/api/mitigation-tasks", json=payload).status_code == 401
    assert client.post("/api/mitigation-tasks", json=payload, headers=auth_headers(field_worker)).status_code == 403
    assert client.post("/api/mitigation-tasks", json=payload, headers=auth_headers(property_manager)).status_code == 201


def test_mitigation_task_read_is_open_to_everyone(client):
    # GET endpoints are intentionally left open (see dependencies/permissions.py
    # module docstring) — no auth required to list tasks.
    assert client.get("/api/mitigation-tasks").status_code == 200
