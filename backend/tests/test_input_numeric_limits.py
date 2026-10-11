"""Numbers get the same treatment as text in test_input_length_limits.py: a value the
column can't hold is a clean 422, never a 500. Amounts are bounded in schemas.py
(Money: DECIMAL(18,2) holds < 1e16), ai_confidence is a 0..1 share, coordinates are
real lat/long. Ids are left unbounded in the schemas; main.py maps the driver's
OverflowError (past BIGINT) and SQL Server's class-22 DataError (e.g. 22003 arithmetic
overflow) to 422. SQLite raises the same OverflowError for an int past 64 bits, so that
path runs for real here; the DataError path is simulated."""
import pytest
from sqlalchemy.exc import DataError

from tests.conftest import auth_headers

PAST_BIGINT = 10**20


def _incident_payload(property_id: int, **overrides) -> dict:
    payload = {
        "property_id": property_id,
        "incident_timestamp": "2024-06-01T10:00:00",
        "hazard_type": "FIRE",
        "severity_level": "MEDIUM",
        "operational_impact": "PARTIAL_SHUTDOWN",
        "initial_estimated_loss": 50000,
        "description": "שריפה קטנה במחסן",
    }
    payload.update(overrides)
    return payload


def _property_payload(**overrides) -> dict:
    payload = {
        "property_code": "PRP-NUM-1",
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


def test_incident_loss_too_large_for_decimal_18_2_is_422(client, make_user, make_property):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    prop = make_property()

    for too_big in (1e16, 99_999_999_999_999_999, 1e300):
        resp = client.post(
            "/api/incidents", json=_incident_payload(prop.property_id, initial_estimated_loss=too_big), headers=headers
        )
        assert resp.status_code == 422, (too_big, resp.text)

    fits = client.post(
        "/api/incidents",
        json=_incident_payload(prop.property_id, initial_estimated_loss=9_999_999_999_999_998),
        headers=headers,
    )
    assert fits.status_code == 201, fits.text


def test_incident_ai_confidence_must_be_a_share_between_0_and_1(client, make_user, make_property):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    prop = make_property()

    for bad in (-0.1, 1.01, 50):
        resp = client.post(
            "/api/incidents",
            json=_incident_payload(prop.property_id, ai_classified=True, ai_confidence=bad),
            headers=headers,
        )
        assert resp.status_code == 422, (bad, resp.text)

    for good in (0, 0.87, 1):
        resp = client.post(
            "/api/incidents",
            json=_incident_payload(prop.property_id, ai_classified=True, ai_confidence=good),
            headers=headers,
        )
        assert resp.status_code == 201, (good, resp.text)


def test_mitigation_amounts_too_large_are_422_on_create_and_update(
    client, make_user, make_property, make_mitigation_task
):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    prop = make_property()
    base = {"property_id": prop.property_id, "title": "התקנת מתזים", "cost_estimate": 1000, "due_date": "2030-01-01"}

    assert client.post("/api/mitigation-tasks", json={**base, "cost_estimate": 1e17}, headers=headers).status_code == 422
    assert (
        client.post("/api/mitigation-tasks", json={**base, "expected_annual_savings": 1e17}, headers=headers).status_code
        == 422
    )

    task = make_mitigation_task(prop.property_id)
    resp = client.patch(f"/api/mitigation-tasks/{task.task_id}", json={"cost_estimate": 1e17}, headers=headers)
    assert resp.status_code == 422


def test_property_coordinates_and_values_are_bounded(client, make_user):
    headers = auth_headers(make_user(role="RISK_MANAGER"))

    for overrides in (
        {"latitude": 91},
        {"latitude": -90.5},
        {"longitude": 180.5},
        {"replacement_value": 1e16},
        {"book_value": 1e16},
    ):
        resp = client.post("/api/properties", json=_property_payload(**overrides), headers=headers)
        assert resp.status_code == 422, (overrides, resp.text)

    edge = client.post(
        "/api/properties", json=_property_payload(latitude=-90, longitude=180), headers=headers
    )
    assert edge.status_code == 201, edge.text


def test_claim_and_policy_amounts_too_large_are_422(client, make_user, make_property, make_incident, make_policy):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    incident = make_incident(make_property().property_id)
    policy = make_policy()

    claim = {"incident_id": incident.incident_id, "policy_id": policy.policy_id, "claimed_amount": 1e16}
    assert client.post("/api/claims", json=claim, headers=headers).status_code == 422

    policy_payload = {
        "policy_number": "POL-NUM-1",
        "insurer_name": "מבטח",
        "start_date": "2024-01-01",
        "end_date": "2025-01-01",
        "total_limit": 1e16,
        "deductible_default": 0,
        "annual_premium": 0,
    }
    assert client.post("/api/policies", json=policy_payload, headers=headers).status_code == 422
    resp = client.post("/api/policies", json={**policy_payload, "bi_waiting_period_hours": 40_000}, headers=headers)
    assert resp.status_code == 422


def test_financial_statement_year_and_amounts_are_bounded(client, make_user):
    headers = auth_headers(make_user(role="CFO"))
    base = {"year": 2024, "total_assets": 1000, "revenue": 1000, "net_income": -50, "insurance_expense": 10}

    assert client.post("/api/financials/statements", json={**base, "year": 40_000}, headers=headers).status_code == 422
    assert client.post("/api/financials/statements", json={**base, "revenue": 1e16}, headers=headers).status_code == 422
    # A net loss is a legitimate negative line.
    resp = client.post("/api/financials/statements", json=base, headers=headers)
    assert resp.status_code == 201, resp.text


@pytest.mark.parametrize(
    "path",
    [
        f"/api/incidents/{PAST_BIGINT}",
        f"/api/properties/{PAST_BIGINT}",
        f"/api/mitigation-tasks/{PAST_BIGINT}",
        f"/api/incidents?property_id={PAST_BIGINT}",
    ],
)
def test_id_past_bigint_is_422_not_500(client, make_user, path):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    resp = client.get(path, headers=headers)
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == "ערך מספרי מחוץ לטווח המותר"


def test_body_id_past_bigint_is_422_not_500(client, make_user):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    resp = client.post("/api/incidents", json=_incident_payload(PAST_BIGINT), headers=headers)
    assert resp.status_code == 422, resp.text


def test_a_sql_server_data_error_is_422_not_500(client, make_user, monkeypatch):
    """What pyodbc raises for SQLSTATE 22003 ("Arithmetic overflow error converting
    expression to data type int"), wrapped by SQLAlchemy as DataError."""
    from app.routers import financials as financials_router

    def overflow(_db):
        raise DataError("SELECT ...", {}, Exception("22003", "Arithmetic overflow error"))

    monkeypatch.setattr(financials_router.financials, "calculate_multi_year_trends", overflow)
    resp = client.get("/api/financials/trends", headers=auth_headers(make_user(role="CFO")))
    assert resp.status_code == 422
    assert resp.json()["detail"] == "ערך מספרי מחוץ לטווח המותר"


def test_epicenter_coordinates_are_bounded(client, make_user):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    for params in ({"latitude": "inf", "longitude": 35}, {"latitude": 32, "longitude": 200}):
        resp = client.get("/api/integrations/seismology/nearest-properties", params=params, headers=headers)
        assert resp.status_code == 422, (params, resp.text)
