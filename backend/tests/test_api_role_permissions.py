"""Integration tests: /api/role-permissions CRUD — TODO_SPEC.md §2, "ניהול
Role_Permissions"."""
from tests.conftest import auth_headers


def _permission_payload(**overrides) -> dict:
    payload = {
        "role": "RISK_MANAGER",
        "permission_key": "incidents:view",
        "description": "צפייה בכל האירועים",
    }
    payload.update(overrides)
    return payload


def test_list_role_permissions_is_open(client):
    resp = client.get("/api/role-permissions")
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_role_permission_requires_admin(client, make_user):
    risk_manager = make_user(role="RISK_MANAGER")
    resp = client.post("/api/role-permissions", json=_permission_payload(), headers=auth_headers(risk_manager))
    assert resp.status_code == 403


def test_create_and_list_role_permission(client, make_user):
    admin = make_user(role="ADMIN")
    resp = client.post("/api/role-permissions", json=_permission_payload(), headers=auth_headers(admin))
    assert resp.status_code == 201
    body = resp.json()
    assert body["role"] == "RISK_MANAGER"
    assert body["permission_key"] == "incidents:view"

    listed = client.get("/api/role-permissions", params={"role": "RISK_MANAGER"})
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    other_role = client.get("/api/role-permissions", params={"role": "CFO"})
    assert other_role.json() == []


def test_create_duplicate_role_permission_is_rejected(client, make_user):
    admin = make_user(role="ADMIN")
    headers = auth_headers(admin)
    first = client.post("/api/role-permissions", json=_permission_payload(), headers=headers)
    assert first.status_code == 201

    duplicate = client.post("/api/role-permissions", json=_permission_payload(), headers=headers)
    assert duplicate.status_code == 400


def test_update_role_permission_description(client, make_user):
    admin = make_user(role="ADMIN")
    headers = auth_headers(admin)
    created = client.post("/api/role-permissions", json=_permission_payload(), headers=headers).json()

    resp = client.patch(
        f"/api/role-permissions/{created['role_permission_id']}",
        json={"description": "תיאור מעודכן"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["description"] == "תיאור מעודכן"


def test_update_missing_role_permission_is_404(client, make_user):
    admin = make_user(role="ADMIN")
    resp = client.patch("/api/role-permissions/999999", json={"description": "x"}, headers=auth_headers(admin))
    assert resp.status_code == 404


def test_delete_role_permission(client, make_user):
    admin = make_user(role="ADMIN")
    headers = auth_headers(admin)
    created = client.post("/api/role-permissions", json=_permission_payload(), headers=headers).json()

    resp = client.delete(f"/api/role-permissions/{created['role_permission_id']}", headers=headers)
    assert resp.status_code == 204

    listed = client.get("/api/role-permissions")
    assert listed.json() == []


def test_delete_role_permission_requires_admin(client, make_user):
    admin = make_user(role="ADMIN")
    created = client.post("/api/role-permissions", json=_permission_payload(), headers=auth_headers(admin)).json()

    field_worker = make_user(role="FIELD_WORKER")
    resp = client.delete(
        f"/api/role-permissions/{created['role_permission_id']}", headers=auth_headers(field_worker)
    )
    assert resp.status_code == 403
