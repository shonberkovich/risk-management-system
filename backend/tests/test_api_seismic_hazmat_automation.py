"""Tests for TODO_SPEC.md §13 ("Backend - API & Logic"):

1. Earthquake-triggered draft incidents (app/routers/incidents.py::check_seismic_activity
   + POST /api/incidents/check-seismic-activity).
2. Hazmat-proximity fire_risk_score penalty on risk-profile create/update
   (app/routers/risk_profiles.py::_apply_hazmat_penalty).

Every external call is mocked at the connector's own bound `get_json`/`get_text` name
(same convention as test_api_integrations_external.py) — no live network access
required.
"""
from __future__ import annotations

import pytest

from app.integrations import environmental, gis, seismology
from app.integrations._http import IntegrationFetchError
from tests.conftest import auth_headers


def _raise(*args, **kwargs):
    raise IntegrationFetchError("simulated network failure")


@pytest.fixture(autouse=True)
def _fast_nominatim_rate_limit(monkeypatch):
    """Same rationale as test_api_integrations_external.py's fixture of the same
    name: collapse Nominatim's real ~1 req/sec throttle to 0 so tests that create
    several draft incidents (each optionally reverse-geocoded) don't take real
    wall-clock seconds."""
    monkeypatch.setattr(gis, "_min_interval_seconds", 0.0)
    monkeypatch.setattr(gis, "_last_call_monotonic", None)


# ---------------------------------------------------------------------------
# Item 1 — earthquake-triggered draft incidents
# ---------------------------------------------------------------------------

_SIGNIFICANT_BULLETIN = (
    "Date,Lat,Long,Depth,Mag,Region\n"
    "2026-08-20 10:15:00,32.081,34.781,10.0,3.5,Tel Aviv area\n"
)

_MINOR_BULLETIN = (
    "Date,Lat,Long,Depth,Mag,Region\n"
    "2026-08-20 10:15:00,32.081,34.781,10.0,2.0,Tel Aviv area\n"
)


def test_check_seismic_activity_creates_draft_for_nearby_property(db, make_property, monkeypatch):
    from app.routers.incidents import check_seismic_activity

    near = make_property(latitude=32.081, longitude=34.781)
    far = make_property(latitude=31.0, longitude=35.0)

    monkeypatch.setattr(seismology, "get_text", lambda *a, **k: _SIGNIFICANT_BULLETIN)
    monkeypatch.setattr(gis, "get_json", lambda *a, **k: {"display_name": "רחוב לדוגמה 1"})

    created = check_seismic_activity(db)

    property_ids = [inc.property_id for inc in created]
    assert near.property_id in property_ids
    assert far.property_id not in property_ids

    drafted = created[property_ids.index(near.property_id)]
    assert drafted.is_draft is True
    assert drafted.hazard_type == "STRUCTURAL_FAILURE"
    assert drafted.reported_by_user_id is None
    assert drafted.status == "NEW"
    # Optional nice-to-have: reverse-geocoded address populated.
    assert drafted.resolved_address == "רחוב לדוגמה 1"


def test_check_seismic_activity_ignores_minor_earthquakes(db, make_property, monkeypatch):
    from app.routers.incidents import check_seismic_activity

    make_property(latitude=32.081, longitude=34.781)
    monkeypatch.setattr(seismology, "get_text", lambda *a, **k: _MINOR_BULLETIN)
    monkeypatch.setattr(gis, "get_json", lambda *a, **k: {"display_name": "כתובת"})

    created = check_seismic_activity(db)
    assert created == []


def test_check_seismic_activity_degrades_gracefully_when_feed_unavailable(db, make_property, monkeypatch):
    from app.routers.incidents import check_seismic_activity

    make_property(latitude=32.081, longitude=34.781)
    monkeypatch.setattr(seismology, "get_text", _raise)

    created = check_seismic_activity(db)
    assert created == []


def test_check_seismic_activity_is_idempotent_on_repeat_calls(db, make_property, monkeypatch):
    """Re-invoking the manual-trigger endpoint while the same earthquake is still
    in GSI's recent-events bulletin must not create a second draft for the same
    property+event."""
    from app.routers.incidents import check_seismic_activity

    make_property(latitude=32.081, longitude=34.781)
    monkeypatch.setattr(seismology, "get_text", lambda *a, **k: _SIGNIFICANT_BULLETIN)
    monkeypatch.setattr(gis, "get_json", lambda *a, **k: {"display_name": "כתובת"})

    first = check_seismic_activity(db)
    second = check_seismic_activity(db)

    assert len(first) == 1
    assert second == []


def test_check_seismic_activity_endpoint_rbac(client, make_user, make_property, monkeypatch):
    make_property(latitude=32.081, longitude=34.781)
    monkeypatch.setattr(seismology, "get_text", lambda *a, **k: _SIGNIFICANT_BULLETIN)
    monkeypatch.setattr(gis, "get_json", lambda *a, **k: {"display_name": "כתובת"})

    risk_manager = make_user(role="RISK_MANAGER")
    field_worker = make_user(role="FIELD_WORKER")

    assert client.post("/api/incidents/check-seismic-activity").status_code == 401
    assert client.post(
        "/api/incidents/check-seismic-activity", headers=auth_headers(field_worker)
    ).status_code == 403

    resp = client.post("/api/incidents/check-seismic-activity", headers=auth_headers(risk_manager))
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["hazard_type"] == "STRUCTURAL_FAILURE"
    assert body[0]["is_draft"] is True


# ---------------------------------------------------------------------------
# Item 2 — hazmat-proximity fire_risk_score penalty
# ---------------------------------------------------------------------------


def _profile_payload(**overrides) -> dict:
    payload = {
        "survey_date": "2024-06-01",
        "flood_risk_score": 3,
        "fire_risk_score": 2,
        "earthquake_risk_score": 4,
        "mfl_amount": 5_000_000,
        "has_sprinklers": True,
    }
    payload.update(overrides)
    return payload


def _fake_hazmat_near_json(url, params=None, headers=None):
    """One hazmat site at the exact coordinates the tests give their property
    (32.09, 34.79) — well within environmental._HAZARD_RADIUS_KM (1.0 km)."""
    if "package_search" in url:
        return {"result": {"results": [{"resources": [{"id": "site-1", "datastore_active": True}]}]}}
    if "datastore_search" in url:
        return {"result": {"records": [{"name": "מפעל כימי", "Lat": "32.09", "Long": "34.79"}]}}
    raise AssertionError(f"unexpected url {url}")


def _fake_hazmat_far_json(url, params=None, headers=None):
    if "package_search" in url:
        return {"result": {"results": [{"resources": [{"id": "site-1", "datastore_active": True}]}]}}
    if "datastore_search" in url:
        return {"result": {"records": [{"name": "מפעל רחוק", "Lat": "-10.0", "Long": "-10.0"}]}}
    raise AssertionError(f"unexpected url {url}")


def test_hazmat_penalty_applied_on_create(client, make_user, make_property, monkeypatch):
    monkeypatch.setattr(environmental, "get_json", _fake_hazmat_near_json)
    admin = make_user(role="ADMIN")
    prop = make_property(latitude=32.09, longitude=34.79)  # first property → within radius of the fake site

    resp = client.post(
        f"/api/properties/{prop.property_id}/risk-profile",
        json=_profile_payload(fire_risk_score=2),
        headers=auth_headers(admin),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["near_hazmat_site"] is True
    assert body["fire_risk_score"] == 3  # 2 + penalty of 1


def test_hazmat_penalty_not_applied_when_not_near_site(client, make_user, make_property, monkeypatch):
    monkeypatch.setattr(environmental, "get_json", _fake_hazmat_far_json)
    admin = make_user(role="ADMIN")
    prop = make_property()

    resp = client.post(
        f"/api/properties/{prop.property_id}/risk-profile",
        json=_profile_payload(fire_risk_score=2),
        headers=auth_headers(admin),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["near_hazmat_site"] is False
    assert body["fire_risk_score"] == 2


def test_hazmat_penalty_clamped_at_max_score(client, make_user, make_property, monkeypatch):
    monkeypatch.setattr(environmental, "get_json", _fake_hazmat_near_json)
    admin = make_user(role="ADMIN")
    prop = make_property(latitude=32.09, longitude=34.79)

    resp = client.post(
        f"/api/properties/{prop.property_id}/risk-profile",
        json=_profile_payload(fire_risk_score=5),
        headers=auth_headers(admin),
    )
    assert resp.status_code == 201
    assert resp.json()["fire_risk_score"] == 5  # clamped, not 6


def test_hazmat_penalty_applied_on_update(client, make_user, make_property, monkeypatch):
    admin = make_user(role="ADMIN")
    prop = make_property(latitude=32.09, longitude=34.79)

    # Created while the connector reports no nearby hazmat site.
    monkeypatch.setattr(environmental, "get_json", _fake_hazmat_far_json)
    created = client.post(
        f"/api/properties/{prop.property_id}/risk-profile",
        json=_profile_payload(fire_risk_score=2),
        headers=auth_headers(admin),
    )
    assert created.json()["near_hazmat_site"] is False

    # A later survey update re-checks the connector, which now reports a hazmat site
    # nearby — the update call itself should trigger the penalty.
    monkeypatch.setattr(environmental, "get_json", _fake_hazmat_near_json)
    updated = client.put(
        f"/api/properties/{prop.property_id}/risk-profile",
        json={"notes": "סקר עדכני"},
        headers=auth_headers(admin),
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body["near_hazmat_site"] is True
    assert body["fire_risk_score"] == 3


def test_hazmat_penalty_not_reapplied_on_subsequent_update(client, make_user, make_property, monkeypatch):
    """Idempotency: once a profile is already flagged near_hazmat_site=True, a
    later unrelated update must not keep stacking the fire_risk_score penalty."""
    monkeypatch.setattr(environmental, "get_json", _fake_hazmat_near_json)
    admin = make_user(role="ADMIN")
    prop = make_property(latitude=32.09, longitude=34.79)

    client.post(
        f"/api/properties/{prop.property_id}/risk-profile",
        json=_profile_payload(fire_risk_score=2),
        headers=auth_headers(admin),
    )
    second = client.put(
        f"/api/properties/{prop.property_id}/risk-profile",
        json={"notes": "עדכון נוסף"},
        headers=auth_headers(admin),
    )
    assert second.status_code == 200
    assert second.json()["fire_risk_score"] == 3  # unchanged from the create-time penalty


def test_hazmat_check_unavailable_does_not_fail_create(client, make_user, make_property, monkeypatch):
    """Environmental integration erroring must degrade gracefully — the risk
    profile is still created, just without the penalty applied."""
    monkeypatch.setattr(environmental, "get_json", _raise)
    admin = make_user(role="ADMIN")
    prop = make_property()

    resp = client.post(
        f"/api/properties/{prop.property_id}/risk-profile",
        json=_profile_payload(fire_risk_score=2),
        headers=auth_headers(admin),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["near_hazmat_site"] is False
    assert body["fire_risk_score"] == 2


def test_hazmat_check_unavailable_does_not_fail_update(client, make_user, make_property, monkeypatch):
    monkeypatch.setattr(environmental, "get_json", lambda *a, **k: {"result": {"results": []}})
    admin = make_user(role="ADMIN")
    prop = make_property()
    client.post(
        f"/api/properties/{prop.property_id}/risk-profile",
        json=_profile_payload(fire_risk_score=2),
        headers=auth_headers(admin),
    )

    monkeypatch.setattr(environmental, "get_json", _raise)
    resp = client.put(
        f"/api/properties/{prop.property_id}/risk-profile",
        json={"mfl_amount": 6_000_000},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 200
    assert resp.json()["mfl_amount"] == 6_000_000
    assert resp.json()["fire_risk_score"] == 2
