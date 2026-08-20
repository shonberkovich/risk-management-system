"""Integration tests: /api/users write endpoints (create, edit, role change,
disable) — TODO_SPEC.md §2, "ניהול משתמשים (users.py)"."""
from tests.conftest import auth_headers


def _user_payload(**overrides) -> dict:
    payload = {
        "full_name": "משתמש בדיקה חדש",
        "email": "new-user@example.com",
        "role": "FIELD_WORKER",
    }
    payload.update(overrides)
    return payload


def test_create_user_requires_auth(client):
    resp = client.post("/api/users", json=_user_payload())
    assert resp.status_code == 401


def test_create_user_forbidden_for_non_admin(client, make_user):
    risk_manager = make_user(role="RISK_MANAGER")
    resp = client.post("/api/users", json=_user_payload(), headers=auth_headers(risk_manager))
    assert resp.status_code == 403


def test_create_user(client, make_user):
    admin = make_user(role="ADMIN")
    resp = client.post("/api/users", json=_user_payload(), headers=auth_headers(admin))
    assert resp.status_code == 201
    body = resp.json()
    assert body["email"] == "new-user@example.com"
    assert body["is_active"] is True

    # Now appears in the open GET /api/users lookup too.
    listed = client.get("/api/users").json()
    assert any(u["user_id"] == body["user_id"] for u in listed)


def test_create_user_duplicate_email_is_rejected(client, make_user):
    admin = make_user(role="ADMIN")
    headers = auth_headers(admin)
    first = client.post("/api/users", json=_user_payload(), headers=headers)
    assert first.status_code == 201

    duplicate = client.post("/api/users", json=_user_payload(), headers=headers)
    assert duplicate.status_code == 400


def test_create_user_with_password_can_log_in(client, make_user):
    admin = make_user(role="ADMIN")
    client.post(
        "/api/users",
        json=_user_payload(email="pwtest@example.com", password="Str0ngPass!"),
        headers=auth_headers(admin),
    )
    resp = client.post("/api/auth/login", json={"email": "pwtest@example.com", "password": "Str0ngPass!"})
    assert resp.status_code == 200


def test_update_user_edit_details_and_role(client, make_user):
    admin = make_user(role="ADMIN")
    headers = auth_headers(admin)
    created = client.post("/api/users", json=_user_payload(), headers=headers).json()

    resp = client.patch(
        f"/api/users/{created['user_id']}",
        json={"full_name": "שם מעודכן", "role": "PROPERTY_MANAGER"},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["full_name"] == "שם מעודכן"
    assert body["role"] == "PROPERTY_MANAGER"


def test_update_missing_user_is_404(client, make_user):
    admin = make_user(role="ADMIN")
    resp = client.patch("/api/users/999999", json={"full_name": "x"}, headers=auth_headers(admin))
    assert resp.status_code == 404


def test_disable_user_blocks_login(client, make_user):
    admin = make_user(role="ADMIN")
    headers = auth_headers(admin)
    target = make_user(role="FIELD_WORKER", email="disableme@example.com")

    resp = client.patch(f"/api/users/{target.user_id}", json={"is_active": False}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False

    login_resp = client.post("/api/auth/login", json={"email": "disableme@example.com", "password": "Demo1234!"})
    assert login_resp.status_code == 401


def test_disable_user_revokes_existing_token_immediately(client, make_user):
    admin = make_user(role="ADMIN")
    headers = auth_headers(admin)
    target = make_user(role="FIELD_WORKER")
    target_headers = auth_headers(target)

    # Token works before disabling...
    assert client.get("/api/auth/me", headers=target_headers).status_code == 200

    client.patch(f"/api/users/{target.user_id}", json={"is_active": False}, headers=headers)

    # ...and is rejected immediately after, without waiting for expiry.
    resp = client.get("/api/auth/me", headers=target_headers)
    assert resp.status_code == 401


def test_admin_cannot_disable_self(client, make_user):
    admin = make_user(role="ADMIN")
    resp = client.patch(f"/api/users/{admin.user_id}", json={"is_active": False}, headers=auth_headers(admin))
    assert resp.status_code == 400
