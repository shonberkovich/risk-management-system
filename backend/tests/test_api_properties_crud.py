"""Integration tests: /api/properties write endpoints (POST, PUT, DELETE) added by
routers/properties.py — TODO_SPEC.md §2, "CRUD מלא לנכסים"."""
from tests.conftest import auth_headers


def _property_payload(**overrides) -> dict:
    payload = {
        "property_code": "PRP-API-TEST-001",
        "name": "מחסן בדיקה",
        "address": "רחוב הבדיקה 1",
        "region": "מרכז",
        "latitude": 32.08,
        "longitude": 34.78,
        "asset_type": "OFFICE_BUILDING",
        "replacement_value": 10_000_000,
        "book_value": 8_000_000,
    }
    payload.update(overrides)
    return payload


def test_create_property_requires_auth(client):
    resp = client.post("/api/properties", json=_property_payload())
    assert resp.status_code == 401


def test_create_property_forbidden_for_field_worker(client, make_user):
    field_worker = make_user(role="FIELD_WORKER")
    resp = client.post("/api/properties", json=_property_payload(), headers=auth_headers(field_worker))
    assert resp.status_code == 403


def test_create_property(client, make_user):
    risk_manager = make_user(role="RISK_MANAGER")
    resp = client.post("/api/properties", json=_property_payload(), headers=auth_headers(risk_manager))
    assert resp.status_code == 201
    body = resp.json()
    assert body["property_code"] == "PRP-API-TEST-001"
    assert body["is_active"] is True
    assert body["manager_name"] is None
    assert body["active_policy"] is None


def test_create_property_duplicate_code_is_rejected(client, make_user):
    admin = make_user(role="ADMIN")
    headers = auth_headers(admin)
    first = client.post("/api/properties", json=_property_payload(), headers=headers)
    assert first.status_code == 201

    duplicate = client.post("/api/properties", json=_property_payload(), headers=headers)
    assert duplicate.status_code == 400


def test_create_property_unknown_manager_is_404(client, make_user):
    admin = make_user(role="ADMIN")
    resp = client.post(
        "/api/properties",
        json=_property_payload(primary_manager_id=999999),
        headers=auth_headers(admin),
    )
    assert resp.status_code == 404


def test_update_property(client, make_user):
    property_manager = make_user(role="PROPERTY_MANAGER")
    headers = auth_headers(property_manager)
    created = client.post("/api/properties", json=_property_payload(), headers=headers).json()

    resp = client.put(
        f"/api/properties/{created['property_id']}",
        json={"name": "מחסן מעודכן", "book_value": 9_000_000},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "מחסן מעודכן"
    assert body["book_value"] == 9_000_000
    # Untouched fields keep their prior values (partial update).
    assert body["property_code"] == "PRP-API-TEST-001"


def test_update_missing_property_is_404(client, make_user):
    admin = make_user(role="ADMIN")
    resp = client.put("/api/properties/999999", json={"name": "x"}, headers=auth_headers(admin))
    assert resp.status_code == 404


def test_delete_property_is_soft_delete(client, make_user):
    admin = make_user(role="ADMIN")
    headers = auth_headers(admin)
    created = client.post("/api/properties", json=_property_payload(), headers=headers).json()
    property_id = created["property_id"]

    resp = client.delete(f"/api/properties/{property_id}", headers=headers)
    assert resp.status_code == 204

    # No longer in the active list...
    listed = client.get("/api/properties").json()
    assert property_id not in [p["property_id"] for p in listed]

    # ...but still reachable by id, with is_active=False (soft delete, not a hard delete).
    fetched = client.get(f"/api/properties/{property_id}")
    assert fetched.status_code == 200
    assert fetched.json()["is_active"] is False


def test_delete_missing_property_is_404(client, make_user):
    admin = make_user(role="ADMIN")
    resp = client.delete("/api/properties/999999", headers=auth_headers(admin))
    assert resp.status_code == 404


def test_delete_property_forbidden_for_field_worker(client, make_user, make_property):
    field_worker = make_user(role="FIELD_WORKER")
    prop = make_property()
    resp = client.delete(f"/api/properties/{prop.property_id}", headers=auth_headers(field_worker))
    assert resp.status_code == 403


def test_create_property_rejects_negative_replacement_value(client, make_user):
    """replacement_value/book_value must be non-negative — same Field(ge=0)
    guard already applied to every other money field in schemas.py
    (claimed_amount, deductible_default, reserve_amount, ...)."""
    admin = make_user(role="ADMIN")
    resp = client.post(
        "/api/properties", json=_property_payload(replacement_value=-1), headers=auth_headers(admin)
    )
    assert resp.status_code == 422


def test_create_property_rejects_negative_book_value(client, make_user):
    admin = make_user(role="ADMIN")
    resp = client.post("/api/properties", json=_property_payload(book_value=-500), headers=auth_headers(admin))
    assert resp.status_code == 422


def test_update_property_rejects_negative_replacement_value(client, make_user, make_property):
    admin = make_user(role="ADMIN")
    prop = make_property()
    resp = client.put(
        f"/api/properties/{prop.property_id}", json={"replacement_value": -1}, headers=auth_headers(admin)
    )
    assert resp.status_code == 422
