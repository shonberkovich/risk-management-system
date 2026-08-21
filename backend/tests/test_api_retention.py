"""HTTP-layer tests for routers/retention.py — 404s for unknown policy/property/
incident, and 422s for invalid query params. The endpoints are intentionally
public/unauthenticated (see test_rbac_regression.py's
test_retention_get_endpoint_stays_open_to_field_worker) so no auth headers are
used here; the actual cost-model math is covered by test_services_retention.py.
"""
from __future__ import annotations


def test_recommendation_404s_for_unknown_policy(client, make_property):
    prop = make_property()
    resp = client.get(
        f"/api/retention/recommendation?policy_id=999999&property_id={prop.property_id}&estimated_loss=1000"
    )
    assert resp.status_code == 404


def test_recommendation_404s_for_unknown_property(client, make_policy):
    policy = make_policy()
    resp = client.get(
        f"/api/retention/recommendation?policy_id={policy.policy_id}&property_id=999999&estimated_loss=1000"
    )
    assert resp.status_code == 404


def test_recommendation_rejects_zero_estimated_loss(client, make_property, make_policy):
    """estimated_loss has `gt=0` — a real damage estimate can't be zero or
    negative; must reject before ever reaching the cost-model calculation."""
    prop, policy = make_property(), make_policy()
    resp = client.get(
        f"/api/retention/recommendation?policy_id={policy.policy_id}&property_id={prop.property_id}&estimated_loss=0"
    )
    assert resp.status_code == 422


def test_recommendation_rejects_negative_estimated_loss(client, make_property, make_policy):
    prop, policy = make_property(), make_policy()
    resp = client.get(
        f"/api/retention/recommendation?policy_id={policy.policy_id}&property_id={prop.property_id}&estimated_loss=-500"
    )
    assert resp.status_code == 422


def test_recommendation_rejects_non_numeric_estimated_loss(client, make_property, make_policy):
    prop, policy = make_property(), make_policy()
    resp = client.get(
        f"/api/retention/recommendation?policy_id={policy.policy_id}&property_id={prop.property_id}&estimated_loss=abc"
    )
    assert resp.status_code == 422


def test_recommendation_rejects_missing_required_params(client):
    assert client.get("/api/retention/recommendation").status_code == 422


def test_recommendation_negative_ids_404_gracefully(client, make_property, make_policy):
    """policy_id/property_id have no explicit `gt=0` constraint — a negative id
    (or one from a stale/malicious client) must 404, not 500."""
    prop, policy = make_property(), make_policy()
    resp = client.get(
        f"/api/retention/recommendation?policy_id=-1&property_id={prop.property_id}&estimated_loss=1000"
    )
    assert resp.status_code == 404


def test_recommendation_happy_path_shape(client, make_property, make_policy):
    prop = make_property()
    policy = make_policy(deductible_default=5_000)
    resp = client.get(
        f"/api/retention/recommendation?policy_id={policy.policy_id}&property_id={prop.property_id}&estimated_loss=50000"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["recommendation"] in ("ABSORB", "CLAIM")
    assert body["incident_id"] is None


def test_recommendation_for_incident_404s_for_unknown_incident(client):
    resp = client.get("/api/retention/incidents/999999")
    assert resp.status_code == 404


def test_recommendation_for_incident_404s_when_property_has_no_active_policy(client, make_property, make_incident):
    prop = make_property()
    incident = make_incident(prop.property_id, initial_estimated_loss=10_000)
    resp = client.get(f"/api/retention/incidents/{incident.incident_id}")
    assert resp.status_code == 404


def test_recommendation_for_incident_happy_path(client, make_property, make_policy, make_incident, db):
    from app import models

    prop = make_property()
    policy = make_policy(deductible_default=1_000, status="ACTIVE")
    db.add(models.PolicyAsset(policy_id=policy.policy_id, property_id=prop.property_id))
    db.commit()
    incident = make_incident(prop.property_id, initial_estimated_loss=25_000)

    resp = client.get(f"/api/retention/incidents/{incident.incident_id}")

    assert resp.status_code == 200
    body = resp.json()
    assert body["incident_id"] == incident.incident_id
    assert body["policy_id"] == policy.policy_id
    assert body["estimated_loss"] == 25_000.0
