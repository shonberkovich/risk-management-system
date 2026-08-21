"""Full regression suite for RBAC on GET endpoints (TODO_SPEC.md §9, item 2:
"בדיקות הרשאות רגרסיה — יצירת טסטים למערך ה-RBAC על פונקציות הקריאה (GET) כדי
לוודא שמשתמשי שטח לא נחשפים למידע פיננסי").

Builds on the two representative-endpoint checks already in test_api_permissions.py
(test_financial_get_endpoints_block_field_worker_and_anonymous /
test_operational_analytics_get_endpoints_stay_open) with a complete map of every
GET route in backend/app/routers/, derived by reading each router file and its
`require_roles(...)` dependency:

- **Gated financial/sensitive GET endpoints** (block FIELD_WORKER with 403, allow
  at least one authorized role with 200): analytics.py's `_FINANCIAL_READ_ROLES`
  endpoints, policies.py's `_POLICIES_READ_ROLES` endpoints (list/by-id/assets),
  incidents.py's `/eligible-policies` (shares `_POLICIES_READ_ROLES`),
  financials.py's `_FINANCIALS_ROLES` endpoints, compliance.py's
  `_COMPLIANCE_ROLES`, audit.py's `_AUDIT_ROLES` (ADMIN-only), and
  integrations.py's `_ERP_ROLES`/`_GIS_ROLES`/`_ECONOMICS_ROLES` endpoints.
- **Intentionally open GET endpoints** (must stay reachable by FIELD_WORKER, no
  token needed): analytics.py's map/risk-matrix/alerts/hazard-distribution,
  claims.py's list/by-id/payments/reserves, incidents.py's list/by-id/full,
  properties.py, mitigation-tasks, risk-profiles, retention, simulation, users
  list, integrations.py's weather alerts (deliberately open to any authenticated
  role — see its module comment) — a future accidental over-restriction on any
  of these should fail a test here.

Each endpoint is exercised against a minimal but valid fixture setup (property /
incident / policy / claim as needed) so a 500 from missing joined data doesn't
mask what we're actually testing (the 403/200 split).
"""
from __future__ import annotations

from datetime import date, datetime

import pytest

from app.integrations._http import IntegrationFetchError
from tests.conftest import auth_headers


@pytest.fixture(autouse=True)
def _no_live_network_calls(monkeypatch):
    """RBAC tests below hit the new §12 real-connector endpoints
    (economics/boi-market-data, home-front/alerts, seismology/*,
    environmental/*, gis/reverse-geocode) purely to check the 401/403/200
    role gate, not to exercise a live external API — this test suite must
    not depend on internet access (see TODO_SPEC.md §12's testing note).
    Forcing every outbound call in app.integrations._http to fail fast
    exercises each endpoint's documented graceful-degradation path (a
    clean 200 with status="unavailable"), which is also exactly what
    happens in a sandboxed dev environment with no outbound network —
    a representative, not just convenient, thing to test."""
    def _always_unavailable(*args, **kwargs):
        raise IntegrationFetchError("network calls disabled in tests")

    # Each connector module did `from app.integrations._http import get_json` (or
    # get_text), which binds its OWN local name at import time — patching
    # app.integrations._http.get_json alone would not reach those already-bound
    # references, so every consuming module's local name is patched explicitly.
    for module_name, attr in [
        ("app.integrations.economics", "get_json"),
        ("app.integrations.home_front", "get_json"),
        ("app.integrations.seismology", "get_text"),
        ("app.integrations.environmental", "get_json"),
        ("app.integrations.gis", "get_json"),
    ]:
        monkeypatch.setattr(f"{module_name}.{attr}", _always_unavailable)


# ---------------------------------------------------------------------------
# Gated financial/sensitive GET endpoints
# ---------------------------------------------------------------------------


def test_analytics_financial_get_endpoints_block_field_worker(client, make_user):
    """analytics.py's _FINANCIAL_READ_ROLES gate — full endpoint list."""
    field_worker = make_user(role="FIELD_WORKER")
    risk_manager = make_user(role="RISK_MANAGER")
    admin = make_user(role="ADMIN")

    endpoints = [
        "/api/analytics/kpis",
        "/api/analytics/cashflow",
        "/api/analytics/exposure-by-region",
        "/api/analytics/geographic-exposure-clusters",
        "/api/analytics/loss-ratio-trend",
    ]
    for path in endpoints:
        assert client.get(path).status_code == 401, path
        assert client.get(path, headers=auth_headers(field_worker)).status_code == 403, path
        assert client.get(path, headers=auth_headers(risk_manager)).status_code == 200, path
        assert client.get(path, headers=auth_headers(admin)).status_code == 200, path


def test_policies_get_endpoints_block_field_worker(client, make_user, make_policy, make_property):
    field_worker = make_user(role="FIELD_WORKER")
    risk_manager = make_user(role="RISK_MANAGER")
    policy = make_policy()
    prop = make_property()

    endpoints = [
        "/api/policies",
        f"/api/policies/{policy.policy_id}",
        f"/api/policies/{policy.policy_id}/assets",
    ]
    for path in endpoints:
        assert client.get(path).status_code == 401, path
        assert client.get(path, headers=auth_headers(field_worker)).status_code == 403, path
        assert client.get(path, headers=auth_headers(risk_manager)).status_code == 200, path


def test_incidents_eligible_policies_blocks_field_worker(
    client, make_user, make_property, make_incident
):
    """incidents.py's /{incident_id}/eligible-policies shares _POLICIES_READ_ROLES
    with policies.py — same financial-disclosure rationale (returns PolicyOut)."""
    field_worker = make_user(role="FIELD_WORKER")
    adjuster = make_user(role="ADJUSTER")
    prop = make_property()
    incident = make_incident(prop.property_id)

    path = f"/api/incidents/{incident.incident_id}/eligible-policies"
    assert client.get(path).status_code == 401
    assert client.get(path, headers=auth_headers(field_worker)).status_code == 403
    assert client.get(path, headers=auth_headers(adjuster)).status_code == 200


def test_financials_get_endpoints_block_field_worker(client, make_user):
    field_worker = make_user(role="FIELD_WORKER")
    cfo = make_user(role="CFO")

    endpoints = [
        "/api/financials/trends",
        "/api/financials/regulatory-report",
        "/api/financials/statements",
    ]
    for path in endpoints:
        assert client.get(path).status_code == 401, path
        assert client.get(path, headers=auth_headers(field_worker)).status_code == 403, path
        assert client.get(path, headers=auth_headers(cfo)).status_code == 200, path


def test_compliance_get_endpoint_blocks_field_worker(client, make_user):
    field_worker = make_user(role="FIELD_WORKER")
    risk_officer = make_user(role="RISK_OFFICER")

    path = "/api/compliance/iso31000-report"
    assert client.get(path).status_code == 401
    assert client.get(path, headers=auth_headers(field_worker)).status_code == 403
    assert client.get(path, headers=auth_headers(risk_officer)).status_code == 200


def test_audit_log_get_endpoints_block_field_worker(client, make_user):
    """ADMIN-only (_AUDIT_ROLES) — a broader block than the financial-role-set
    endpoints above, but the same shape: FIELD_WORKER (and any non-ADMIN) is 403."""
    field_worker = make_user(role="FIELD_WORKER")
    risk_manager = make_user(role="RISK_MANAGER")  # not ADMIN either
    admin = make_user(role="ADMIN")

    endpoints = ["/api/audit-log", "/api/audit-log/entity-types"]
    for path in endpoints:
        assert client.get(path).status_code == 401, path
        assert client.get(path, headers=auth_headers(field_worker)).status_code == 403, path
        assert client.get(path, headers=auth_headers(risk_manager)).status_code == 403, path
        assert client.get(path, headers=auth_headers(admin)).status_code == 200, path


def test_integrations_finance_and_gis_get_endpoints_block_field_worker(client, make_user, make_property):
    """integrations.py's ERP (_ERP_ROLES), GIS (_GIS_ROLES) and economics
    (_ECONOMICS_ROLES) GET endpoints — all finance/risk-assessment facing,
    none open to FIELD_WORKER."""
    field_worker = make_user(role="FIELD_WORKER")
    admin = make_user(role="ADMIN")
    make_property()

    endpoints = [
        "/api/integrations/erp/book-values",
        "/api/integrations/gis/risk-layers",
        "/api/integrations/economics/index-series",
        "/api/integrations/economics/replacement-value-updates",
        "/api/integrations/economics/boi-market-data",
        "/api/integrations/seismology/recent-earthquakes",
        "/api/integrations/environmental/hazmat-sites",
    ]
    for path in endpoints:
        assert client.get(path).status_code == 401, path
        assert client.get(path, headers=auth_headers(field_worker)).status_code == 403, path
        assert client.get(path, headers=auth_headers(admin)).status_code == 200, path

    # Two GIS/economics endpoints take required query params — checked separately
    # so the loop above stays a plain path list for the no-params majority.
    prop = make_property()
    param_endpoints = [
        "/api/integrations/seismology/nearest-properties?latitude=32.08&longitude=34.78",
        "/api/integrations/environmental/property-hazmat-proximity",
        f"/api/integrations/environmental/property-hazmat-proximity?property_id={prop.property_id}",
    ]
    for path in param_endpoints:
        assert client.get(path).status_code == 401, path
        assert client.get(path, headers=auth_headers(field_worker)).status_code == 403, path
        assert client.get(path, headers=auth_headers(admin)).status_code == 200, path


# ---------------------------------------------------------------------------
# Intentionally open GET endpoints — must stay reachable by FIELD_WORKER
# ---------------------------------------------------------------------------


def test_operational_analytics_get_endpoints_stay_open_to_field_worker(client, make_user):
    field_worker = make_user(role="FIELD_WORKER")
    endpoints = [
        "/api/analytics/map",
        "/api/analytics/risk-matrix",
        "/api/analytics/alerts",
        "/api/analytics/hazard-distribution",
    ]
    for path in endpoints:
        assert client.get(path).status_code == 200, path
        assert client.get(path, headers=auth_headers(field_worker)).status_code == 200, path


def test_claims_get_endpoints_stay_open_to_field_worker(
    client, make_user, make_property, make_incident, make_policy, make_claim
):
    field_worker = make_user(role="FIELD_WORKER")
    prop = make_property()
    incident = make_incident(prop.property_id)
    policy = make_policy()
    claim = make_claim(incident.incident_id, policy.policy_id)

    endpoints = [
        "/api/claims",
        f"/api/claims/{claim.claim_id}",
        f"/api/claims/{claim.claim_id}/payments",
        f"/api/claims/{claim.claim_id}/reserves",
    ]
    for path in endpoints:
        assert client.get(path).status_code == 200, path
        assert client.get(path, headers=auth_headers(field_worker)).status_code == 200, path


def test_incidents_get_endpoints_stay_open_to_field_worker(client, make_user, make_property, make_incident):
    field_worker = make_user(role="FIELD_WORKER")
    prop = make_property()
    incident = make_incident(prop.property_id)

    endpoints = [
        "/api/incidents",
        f"/api/incidents/{incident.incident_id}",
        f"/api/incidents/{incident.incident_id}/full",
    ]
    for path in endpoints:
        assert client.get(path).status_code == 200, path
        assert client.get(path, headers=auth_headers(field_worker)).status_code == 200, path


def test_properties_get_endpoints_stay_open_to_field_worker(client, make_user, make_property):
    field_worker = make_user(role="FIELD_WORKER")
    prop = make_property()

    endpoints = ["/api/properties", f"/api/properties/{prop.property_id}"]
    for path in endpoints:
        assert client.get(path).status_code == 200, path
        assert client.get(path, headers=auth_headers(field_worker)).status_code == 200, path


def test_mitigation_get_endpoints_stay_open_to_field_worker(
    client, make_user, make_property, make_mitigation_task
):
    field_worker = make_user(role="FIELD_WORKER")
    prop = make_property()
    task = make_mitigation_task(prop.property_id)

    endpoints = [
        "/api/mitigation-tasks",
        "/api/mitigation-tasks/roi-summary",
        f"/api/mitigation-tasks/{task.task_id}",
        f"/api/mitigation-tasks/{task.task_id}/roi",
    ]
    for path in endpoints:
        assert client.get(path).status_code == 200, path
        assert client.get(path, headers=auth_headers(field_worker)).status_code == 200, path


def test_risk_profile_get_endpoint_stays_open_to_field_worker(
    client, make_user, make_property, make_risk_profile
):
    field_worker = make_user(role="FIELD_WORKER")
    prop = make_property()
    make_risk_profile(prop.property_id)

    path = f"/api/properties/{prop.property_id}/risk-profile"
    assert client.get(path).status_code == 200, path
    assert client.get(path, headers=auth_headers(field_worker)).status_code == 200, path


def test_retention_get_endpoint_stays_open_to_field_worker(client, make_user, make_property, make_policy):
    field_worker = make_user(role="FIELD_WORKER")
    prop = make_property()
    policy = make_policy()

    path = (
        f"/api/retention/recommendation?policy_id={policy.policy_id}"
        f"&property_id={prop.property_id}&estimated_loss=50000"
    )
    assert client.get(path).status_code == 200, path
    assert client.get(path, headers=auth_headers(field_worker)).status_code == 200, path


def test_simulation_get_endpoint_stays_open_to_field_worker(client, make_user, make_property, make_risk_profile):
    field_worker = make_user(role="FIELD_WORKER")
    prop = make_property()
    make_risk_profile(prop.property_id)

    path = "/api/simulation/portfolio"
    assert client.get(path).status_code == 200, path
    assert client.get(path, headers=auth_headers(field_worker)).status_code == 200, path


def test_users_list_get_endpoint_stays_open_to_field_worker(client, make_user):
    field_worker = make_user(role="FIELD_WORKER")

    path = "/api/users"
    assert client.get(path).status_code == 200, path
    assert client.get(path, headers=auth_headers(field_worker)).status_code == 200, path


def test_integrations_weather_alerts_open_to_any_authenticated_role(client, make_user, make_property):
    """The one integrations.py GET deliberately left open (require_roles() with no
    args = authenticated, any role) — per its module comment, a field worker needs
    a storm warning as much as a risk officer does. Still requires a token, unlike
    the map/risk-matrix/claims endpoints above which are fully anonymous-open."""
    field_worker = make_user(role="FIELD_WORKER")
    make_property()

    path = "/api/integrations/weather/alerts"
    assert client.get(path).status_code == 401, path
    assert client.get(path, headers=auth_headers(field_worker)).status_code == 200, path


def test_integrations_home_front_and_reverse_geocode_open_to_any_authenticated_role(
    client, make_user, make_property
):
    """TODO_SPEC.md §12's other two `require_roles()`-with-no-args endpoints:
    Home Front Command alerts (safety takes priority over role-gating, same
    as weather) and OSM Nominatim reverse geocoding (explicitly meant to
    serve field workers filing an incident report from GPS coordinates)."""
    field_worker = make_user(role="FIELD_WORKER")
    make_property()

    endpoints = [
        "/api/integrations/home-front/alerts",
        "/api/integrations/gis/reverse-geocode?latitude=32.08&longitude=34.78",
    ]
    for path in endpoints:
        assert client.get(path).status_code == 401, path
        assert client.get(path, headers=auth_headers(field_worker)).status_code == 200, path


# ---------------------------------------------------------------------------
# users.py's admin-only GET endpoint (not financial, but a good regression
# anchor: distinct from the FIELD_WORKER-blocked list above — it blocks
# everyone except the _USERS_WRITE_ROLES set, so check the FIELD_WORKER case
# for consistency with the rest of the gated-endpoint map).
# ---------------------------------------------------------------------------


def test_users_admin_get_endpoint_blocks_field_worker(client, make_user):
    field_worker = make_user(role="FIELD_WORKER")
    admin = make_user(role="ADMIN")

    path = "/api/users/admin"
    assert client.get(path).status_code == 401, path
    assert client.get(path, headers=auth_headers(field_worker)).status_code == 403, path
    assert client.get(path, headers=auth_headers(admin)).status_code == 200, path
