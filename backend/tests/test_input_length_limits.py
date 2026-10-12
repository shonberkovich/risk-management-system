"""Text inputs are capped to their NVARCHAR(n) column (schemas.py) so an over-long value
is a clean 422 rather than a SQL Server "String or binary data would be truncated"
500 — which the SQLite test DB itself would never raise, hence testing the schema
limits directly. Encrypted columns are capped by encoded size (ENCRYPTED_COLUMN_MAX_BYTES)."""
from tests.conftest import auth_headers


def _property_payload(**overrides) -> dict:
    payload = {
        "property_code": "PRP-LEN-1",
        "name": "נכס",
        "address": "רחוב 1",
        "region": "מרכז",
        "latitude": 32.0,
        "longitude": 34.8,
        "asset_type": "RETAIL",
        "replacement_value": 1_000_000,
        "book_value": 900_000,
    }
    payload.update(overrides)
    return payload


def test_property_name_longer_than_column_is_422(client, make_user):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    too_long = client.post("/api/properties", json=_property_payload(name="א" * 201), headers=headers)
    assert too_long.status_code == 422
    at_limit = client.post("/api/properties", json=_property_payload(name="א" * 200), headers=headers)
    assert at_limit.status_code == 201


def test_encrypted_adjuster_name_is_capped_by_encoded_size(client, make_user, make_property, make_incident, make_policy):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    incident = make_incident(make_property().property_id)
    policy = make_policy(covers=incident.property_id)
    base = {"incident_id": incident.incident_id, "policy_id": policy.policy_id, "claimed_amount": 1000}

    # 70 Hebrew letters = 140 UTF-8 bytes -> its Fernet token would overflow NVARCHAR(255).
    resp = client.post("/api/claims", json={**base, "adjuster_name": "ש" * 70}, headers=headers)
    assert resp.status_code == 422

    resp = client.post("/api/claims", json={**base, "adjuster_name": "ש" * 60}, headers=headers)
    assert resp.status_code == 201
    assert resp.json()["adjuster_name"] == "ש" * 60


def test_agent_chat_session_id_longer_than_column_is_422(client, make_user):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    resp = client.post("/api/ai/agent-chat", json={"message": "שלום", "session_id": "x" * 65}, headers=headers)
    assert resp.status_code == 422


def test_document_doc_type_longer_than_column_is_422(client, make_user, make_property):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    prop = make_property()
    resp = client.post(
        f"/api/documents/entity/PROPERTY/{prop.property_id}",
        params={"doc_type": "X" * 31},
        files={"file": ("a.pdf", b"%PDF-1.4", "application/pdf")},
        headers=headers,
    )
    assert resp.status_code == 422
