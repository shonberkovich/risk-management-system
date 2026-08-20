"""Integration tests: /api/financials/statements (create/list Financial_Statements)
— TODO_SPEC.md §2, "API פיננסי"."""
from tests.conftest import auth_headers


def _statement_payload(**overrides) -> dict:
    payload = {
        "year": 2025,
        "total_assets": 100_000_000,
        "revenue": 40_000_000,
        "net_income": 5_000_000,
        "insurance_expense": 2_000_000,
    }
    payload.update(overrides)
    return payload


def test_create_statement_requires_auth(client):
    resp = client.post("/api/financials/statements", json=_statement_payload())
    assert resp.status_code == 401


def test_create_statement_forbidden_for_field_worker(client, make_user):
    field_worker = make_user(role="FIELD_WORKER")
    resp = client.post(
        "/api/financials/statements", json=_statement_payload(), headers=auth_headers(field_worker)
    )
    assert resp.status_code == 403


def test_create_statement(client, make_user):
    cfo = make_user(role="CFO")
    resp = client.post(
        "/api/financials/statements",
        json=_statement_payload(total_liabilities=60_000_000, total_equity=40_000_000),
        headers=auth_headers(cfo),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["year"] == 2025
    assert body["total_liabilities"] == 60_000_000

    listed = client.get("/api/financials/statements", headers=auth_headers(cfo))
    assert listed.status_code == 200
    assert [s["year"] for s in listed.json()] == [2025]


def test_create_statement_duplicate_year_is_rejected(client, make_user):
    admin = make_user(role="ADMIN")
    headers = auth_headers(admin)
    first = client.post("/api/financials/statements", json=_statement_payload(), headers=headers)
    assert first.status_code == 201

    duplicate = client.post("/api/financials/statements", json=_statement_payload(), headers=headers)
    assert duplicate.status_code == 400


def test_new_statement_feeds_multi_year_trends(client, make_user):
    manager = make_user(role="RISK_MANAGER")
    headers = auth_headers(manager)
    client.post("/api/financials/statements", json=_statement_payload(), headers=headers)

    resp = client.get("/api/financials/trends", headers=headers)
    assert resp.status_code == 200
    years = [row["year"] for row in resp.json()]
    assert 2025 in years
