"""Integration tests: /api/policies (CRUD + RBAC + the extended-fields columns from
TODO_SPEC.md stage 1: per_event_limit / bi_waiting_period_hours / exclusions). See
TODO_SPEC.md stage 10 ("בדיקות אינטגרציה ל-API — פוליסות")."""
from tests.conftest import auth_headers


def _policy_payload(**overrides) -> dict:
    payload = {
        "policy_number": "POL-API-TEST-001",
        "insurer_name": "מבטח בדיקה",
        "start_date": "2024-01-01",
        "end_date": "2025-01-01",
        "total_limit": 50_000_000,
        "deductible_default": 50_000,
        "annual_premium": 500_000,
    }
    payload.update(overrides)
    return payload


def test_create_policy_requires_write_role(client):
    resp = client.post("/api/policies", json=_policy_payload())
    assert resp.status_code == 401


def test_create_policy_forbidden_for_non_write_role(client, make_user):
    field_worker = make_user(role="FIELD_WORKER")
    resp = client.post("/api/policies", json=_policy_payload(), headers=auth_headers(field_worker))
    assert resp.status_code == 403


def test_create_policy_with_extended_fields(client, make_user):
    cfo = make_user(role="CFO")
    resp = client.post(
        "/api/policies",
        json=_policy_payload(per_event_limit=10_000_000, bi_waiting_period_hours=72, exclusions="רעידת אדמה"),
        headers=auth_headers(cfo),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["per_event_limit"] == 10_000_000
    assert body["bi_waiting_period_hours"] == 72
    assert body["exclusions"] == "רעידת אדמה"
    assert body["status"] == "ACTIVE"  # PolicyCreate default


def test_create_policy_duplicate_number_is_rejected(client, make_user):
    admin = make_user(role="ADMIN")
    headers = auth_headers(admin)
    first = client.post("/api/policies", json=_policy_payload(), headers=headers)
    assert first.status_code == 201

    duplicate = client.post("/api/policies", json=_policy_payload(), headers=headers)
    assert duplicate.status_code == 400


def test_update_policy(client, make_user):
    cfo = make_user(role="CFO")
    headers = auth_headers(cfo)
    created = client.post("/api/policies", json=_policy_payload(), headers=headers).json()

    resp = client.put(f"/api/policies/{created['policy_id']}", json={"status": "EXPIRED"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "EXPIRED"


def test_update_missing_policy_is_404(client, make_user):
    cfo = make_user(role="CFO")
    resp = client.put("/api/policies/999999", json={"status": "EXPIRED"}, headers=auth_headers(cfo))
    assert resp.status_code == 404


def test_list_and_filter_policies_by_status(client, make_user):
    cfo = make_user(role="CFO")
    headers = auth_headers(cfo)
    client.post("/api/policies", json=_policy_payload(policy_number="POL-A", status="ACTIVE"), headers=headers)
    client.post("/api/policies", json=_policy_payload(policy_number="POL-B", status="EXPIRED"), headers=headers)

    resp = client.get("/api/policies", params={"status": "ACTIVE"})
    assert resp.status_code == 200
    assert [p["policy_number"] for p in resp.json()] == ["POL-A"]
