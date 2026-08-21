"""Integration tests for routers/analytics.py — previously untested endpoints:
kpis, map, risk-matrix, loss-ratio-trend, alerts, cashflow, exposure-by-region,
geographic-exposure-clusters, hazard-distribution. See TODO_SPEC.md §9,
"בדיקות Backend"."""
from datetime import date

from tests.conftest import auth_headers

_FINANCIAL_ROLES_FORBIDDEN_FOR = "FIELD_WORKER"


def test_kpis_requires_auth(client):
    resp = client.get("/api/analytics/kpis")
    assert resp.status_code == 401


def test_kpis_forbidden_for_field_worker(client, make_user):
    worker = make_user(role=_FINANCIAL_ROLES_FORBIDDEN_FOR)
    resp = client.get("/api/analytics/kpis", headers=auth_headers(worker))
    assert resp.status_code == 403


def test_kpis_ok_for_risk_manager(client, make_user, make_property, make_risk_profile):
    prop = make_property()
    make_risk_profile(prop.property_id)
    manager = make_user(role="RISK_MANAGER")
    resp = client.get("/api/analytics/kpis", headers=auth_headers(manager))
    assert resp.status_code == 200
    body = resp.json()
    assert "tiv" in body
    assert "mfl" in body


def test_map_endpoint_is_open_and_colors_by_incident_severity(client, make_property, make_incident):
    green_prop = make_property(property_code="P-GREEN")
    red_prop = make_property(property_code="P-RED")
    make_incident(red_prop.property_id, severity_level="CRITICAL", status="NEW")

    resp = client.get("/api/analytics/map")
    assert resp.status_code == 200
    points = {p["property_id"]: p for p in resp.json()}
    assert points[green_prop.property_id]["status_color"] == "green"
    assert points[red_prop.property_id]["status_color"] == "red"


def test_map_excludes_inactive_properties(client, make_property):
    active = make_property(property_code="P-ACTIVE", is_active=True)
    make_property(property_code="P-INACTIVE", is_active=False)

    resp = client.get("/api/analytics/map")
    ids = [p["property_id"] for p in resp.json()]
    assert active.property_id in ids
    assert len(ids) == 1


def test_risk_matrix_buckets_properties_by_probability_and_severity(client, make_property, make_risk_profile, make_incident):
    # High risk score + CRITICAL open incident -> should land in the high/high cell.
    prop = make_property()
    make_risk_profile(prop.property_id, flood_risk_score=5, fire_risk_score=5, earthquake_risk_score=5)
    make_incident(prop.property_id, severity_level="CRITICAL", status="NEW")

    resp = client.get("/api/analytics/risk-matrix")
    assert resp.status_code == 200
    cells = resp.json()
    assert len(cells) == 9
    high_high = next(c for c in cells if c["probability_band"] == "high" and c["severity_band"] == "high")
    assert prop.property_id in high_high["property_ids"]


def test_risk_matrix_defaults_property_with_no_incidents_to_low_severity(client, make_property):
    prop = make_property()
    resp = client.get("/api/analytics/risk-matrix")
    cells = resp.json()
    low_low = next(c for c in cells if c["probability_band"] == "low" and c["severity_band"] == "low")
    assert prop.property_id in low_low["property_ids"]


def test_loss_ratio_trend_requires_auth(client):
    resp = client.get("/api/analytics/loss-ratio-trend")
    assert resp.status_code == 401


def test_loss_ratio_trend_ok(client, make_user, make_property, make_risk_profile, make_policy, make_incident, make_claim):
    prop = make_property()
    make_risk_profile(prop.property_id)
    policy = make_policy(annual_premium=1_000_000)
    incident = make_incident(prop.property_id, incident_timestamp=date(2024, 3, 1))
    make_claim(incident.incident_id, policy.policy_id, claimed_amount=100_000)
    manager = make_user(role="RISK_MANAGER")

    resp = client.get("/api/analytics/loss-ratio-trend", headers=auth_headers(manager))
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_alerts_endpoint_is_open_and_returns_list(client, make_property):
    make_property()
    resp = client.get("/api/analytics/alerts")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_cashflow_requires_auth(client):
    resp = client.get("/api/analytics/cashflow")
    assert resp.status_code == 401


def test_cashflow_forbidden_for_field_worker(client, make_user):
    worker = make_user(role="FIELD_WORKER")
    resp = client.get("/api/analytics/cashflow", headers=auth_headers(worker))
    assert resp.status_code == 403


def test_cashflow_ok_and_respects_months_ahead(client, make_user):
    manager = make_user(role="RISK_MANAGER")
    resp = client.get("/api/analytics/cashflow?months_ahead=6", headers=auth_headers(manager))
    assert resp.status_code == 200
    body = resp.json()
    assert body["total_open_reserves"] == 0.0
    assert body["monthly"] == []


def test_exposure_by_region_requires_finance_role(client, make_user):
    worker = make_user(role="FIELD_WORKER")
    resp = client.get("/api/analytics/exposure-by-region", headers=auth_headers(worker))
    assert resp.status_code == 403


def test_exposure_by_region_groups_by_property_region(client, db, make_user, make_property, make_risk_profile):
    from app import models

    region = models.Region(region_id=1, region_code="NORTH", name="צפון")
    db.add(region)
    db.commit()

    prop = make_property(region_id=region.region_id, replacement_value=1_000_000)
    make_risk_profile(prop.property_id, mfl_amount=200_000)
    manager = make_user(role="RISK_MANAGER")

    resp = client.get("/api/analytics/exposure-by-region", headers=auth_headers(manager))
    assert resp.status_code == 200
    regions = {r["region_name"]: r for r in resp.json()}
    assert "צפון" in regions
    assert regions["צפון"]["tiv"] == 1_000_000


def test_exposure_by_region_groups_unassigned_properties(client, make_user, make_property, make_risk_profile):
    prop = make_property(replacement_value=500_000)  # no region_id set
    make_risk_profile(prop.property_id, mfl_amount=100_000)
    manager = make_user(role="RISK_MANAGER")

    resp = client.get("/api/analytics/exposure-by-region", headers=auth_headers(manager))
    regions = {r["region_name"]: r for r in resp.json()}
    assert "לא משויך" in regions


def test_geographic_exposure_clusters_requires_finance_role(client, make_user):
    worker = make_user(role="FIELD_WORKER")
    resp = client.get("/api/analytics/geographic-exposure-clusters", headers=auth_headers(worker))
    assert resp.status_code == 403


def test_geographic_exposure_clusters_ok(client, make_user, make_property, make_risk_profile):
    prop = make_property(latitude=32.0, longitude=34.0)
    make_risk_profile(prop.property_id, mfl_amount=500_000)
    manager = make_user(role="RISK_MANAGER")

    resp = client.get("/api/analytics/geographic-exposure-clusters", headers=auth_headers(manager))
    assert resp.status_code == 200
    clusters = resp.json()
    assert len(clusters) == 1
    assert clusters[0]["cluster_mfl_total"] == 500_000


def test_hazard_distribution_is_open_and_computes_percent(client, make_property, make_incident):
    prop = make_property()
    make_incident(prop.property_id, hazard_type="FIRE")
    make_incident(prop.property_id, hazard_type="FIRE")
    make_incident(prop.property_id, hazard_type="FLOOD")

    resp = client.get("/api/analytics/hazard-distribution")
    assert resp.status_code == 200
    by_type = {row["hazard_type"]: row for row in resp.json()}
    assert by_type["FIRE"]["count"] == 2
    assert by_type["FIRE"]["percent"] == 66.7
    assert by_type["FLOOD"]["count"] == 1


def test_hazard_distribution_empty_db_returns_empty_list(client):
    resp = client.get("/api/analytics/hazard-distribution")
    assert resp.status_code == 200
    assert resp.json() == []
