"""Unit + endpoint tests for the five REAL external connectors added under
TODO_SPEC.md §12 (economics.fetch_boi_market_data, home_front.py,
seismology.py, environmental.py, gis.reverse_geocode). Every test mocks
`app.integrations.<module>.get_json`/`get_text` (the module's own bound
name — see test_rbac_regression.py's `_no_live_network_calls` fixture
docstring for why patching `app.integrations._http.get_json` directly
would not reach these), so this file never makes a real network call and
never requires internet access to pass, per TODO_SPEC.md §12's own testing
note.

RBAC (401/403/200 role gating) for these same endpoints is covered in
test_rbac_regression.py; this file focuses on each connector's actual
parsing/graceful-degradation logic.
"""
from __future__ import annotations

import pytest

from app.integrations import economics, environmental, gis, home_front, seismology
from app.integrations._http import IntegrationFetchError
from tests.conftest import auth_headers


def _raise(*args, **kwargs):
    raise IntegrationFetchError("simulated network failure")


# ---------------------------------------------------------------------------
# economics.py — real BOI market data
# ---------------------------------------------------------------------------


def test_boi_market_data_success(monkeypatch):
    def _fake_get_json(url, params=None, headers=None):
        if "GetExchangeRate" in url and params["key"] == "USD":
            return {"currentExchangeRate": 3.65}
        if "GetExchangeRate" in url and params["key"] == "EUR":
            return {"currentExchangeRate": 3.95}
        if economics._CBS_BASE_URL in url and params["id"] == economics._CBS_CPI_SERIES_ID:
            # cpi_yoy_percent is sourced from CBS's real price-index API (its
            # `percentYear` field), not BOI's own GetInflation — see
            # economics.py's module-level comment for why.
            return {"month": [{"date": [
                {"year": 2026, "month": 7, "percentYear": 3.1, "currBase": {"baseDesc": "2024 ממוצע", "value": 105.1}},
            ]}]}
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr(economics, "get_json", _fake_get_json)
    result = economics.fetch_boi_market_data()

    assert result["source_system"] == "BOI-PUBLIC-API"
    by_series = {s["series"]: s for s in result["series"]}
    assert by_series["exchange_rate_usd"]["value"] == 3.65
    assert by_series["exchange_rate_usd"]["status"] == "ok"
    assert by_series["cpi_yoy_percent"]["value"] == 3.1
    assert by_series["cpi_yoy_percent"]["source_system"] == "CBS-PUBLIC-API"


def test_boi_market_data_degrades_gracefully_on_network_failure(monkeypatch):
    monkeypatch.setattr(economics, "get_json", _raise)
    result = economics.fetch_boi_market_data()

    assert len(result["series"]) == 3
    assert all(s["status"] == "unavailable" and s["value"] is None for s in result["series"])


def test_boi_market_data_degrades_gracefully_on_unexpected_shape(monkeypatch):
    """BOI returns 200 with a JSON body that doesn't contain any of the
    expected value keys — treated the same as a network failure, not a
    crash."""
    monkeypatch.setattr(economics, "get_json", lambda *a, **k: {"unexpected": "shape"})
    result = economics.fetch_boi_market_data()

    assert all(s["status"] == "unavailable" for s in result["series"])


def test_boi_market_data_endpoint_requires_economics_roles(client, make_user, monkeypatch):
    monkeypatch.setattr(economics, "get_json", _raise)
    admin = make_user(role="ADMIN")
    field_worker = make_user(role="FIELD_WORKER")

    assert client.get("/api/integrations/economics/boi-market-data").status_code == 401
    assert client.get(
        "/api/integrations/economics/boi-market-data", headers=auth_headers(field_worker)
    ).status_code == 403
    resp = client.get("/api/integrations/economics/boi-market-data", headers=auth_headers(admin))
    assert resp.status_code == 200
    assert resp.json()["source_system"] == "BOI-PUBLIC-API"


# ---------------------------------------------------------------------------
# home_front.py — real Home Front Command alerts
# ---------------------------------------------------------------------------


def test_home_front_no_active_alerts_is_the_normal_state(monkeypatch):
    monkeypatch.setattr(home_front, "get_json", lambda *a, **k: [])
    result = home_front.fetch_active_alerts()
    assert result == {"status": "ok", "alerts": [], "source_system": "OREF-ALERTS"}


def test_home_front_active_alert_matches_property_by_region(db, make_property, monkeypatch):
    prop = make_property(region="תל אביב")
    make_property(region="חיפה")  # should NOT match

    monkeypatch.setattr(
        home_front, "get_json",
        lambda *a, **k: [{"cat": "1", "title": "ירי רקטות וטילים", "data": ["תל אביב"]}],
    )
    feed = home_front.fetch_active_alerts()
    assert feed["status"] == "ok"
    assert feed["alerts"][0]["areas"] == ["תל אביב"]

    matches = home_front.match_alerts_to_properties(db, feed["alerts"])
    assert [m["property_id"] for m in matches] == [prop.property_id]


def test_home_front_degrades_gracefully_on_network_failure(monkeypatch):
    monkeypatch.setattr(home_front, "get_json", _raise)
    result = home_front.fetch_active_alerts()
    assert result == {"status": "unavailable", "alerts": [], "source_system": "OREF-ALERTS"}


def test_home_front_endpoint_open_to_any_authenticated_role(client, make_user, monkeypatch):
    monkeypatch.setattr(home_front, "get_json", lambda *a, **k: [])
    field_worker = make_user(role="FIELD_WORKER")

    assert client.get("/api/integrations/home-front/alerts").status_code == 401
    resp = client.get("/api/integrations/home-front/alerts", headers=auth_headers(field_worker))
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# seismology.py — real GSI bulletin + haversine distance
# ---------------------------------------------------------------------------

_SAMPLE_BULLETIN = (
    "Date,Lat,Long,Depth,Mag,Region\n"
    "2026-08-20 10:15:00,32.08,34.78,10.0,3.2,Tel Aviv area\n"
    "not,a,valid,row\n"
    "2026-08-19 04:02:11,29.55,34.95,5.0,2.1,Eilat area\n"
)


def test_seismology_bulletin_parses_valid_rows_and_skips_bad_ones(monkeypatch):
    monkeypatch.setattr(seismology, "get_text", lambda *a, **k: _SAMPLE_BULLETIN)
    result = seismology.fetch_recent_earthquakes()

    assert result["status"] == "ok"
    assert len(result["events"]) == 2  # header line and the malformed row are both skipped
    assert result["events"][0]["magnitude"] == 3.2
    assert result["events"][0]["latitude"] == 32.08


def test_seismology_bulletin_degrades_gracefully_on_network_failure(monkeypatch):
    monkeypatch.setattr(seismology, "get_text", _raise)
    result = seismology.fetch_recent_earthquakes()
    assert result == {"status": "unavailable", "events": [], "source_system": "GSI-SEISMOLOGY"}


def test_seismology_nearest_properties_sorted_by_real_distance(db, make_property):
    near = make_property(latitude=32.081, longitude=34.781)   # ~ same point as epicenter
    far = make_property(latitude=31.0, longitude=35.0)         # much farther away

    rows = seismology.nearest_properties_to_epicenter(db, latitude=32.08, longitude=34.78)
    ids_in_order = [r["property_id"] for r in rows]
    assert ids_in_order.index(near.property_id) < ids_in_order.index(far.property_id)
    assert rows[0]["distance_km"] < rows[-1]["distance_km"]


def test_seismology_endpoints_require_gis_roles(client, make_user, make_property, monkeypatch):
    monkeypatch.setattr(seismology, "get_text", lambda *a, **k: _SAMPLE_BULLETIN)
    make_property()
    risk_manager = make_user(role="RISK_MANAGER")
    field_worker = make_user(role="FIELD_WORKER")

    assert client.get("/api/integrations/seismology/recent-earthquakes").status_code == 401
    assert client.get(
        "/api/integrations/seismology/recent-earthquakes", headers=auth_headers(field_worker)
    ).status_code == 403
    resp = client.get(
        "/api/integrations/seismology/recent-earthquakes", headers=auth_headers(risk_manager)
    )
    assert resp.status_code == 200
    assert len(resp.json()["events"]) == 2


# ---------------------------------------------------------------------------
# environmental.py — real data.gov.il CKAN hazmat-sites lookup
# ---------------------------------------------------------------------------


def test_environmental_hazmat_sites_two_step_lookup(monkeypatch):
    def _fake_get_json(url, params=None, headers=None):
        if "package_search" in url:
            return {"result": {"results": [
                {"resources": [{"id": "abc-123", "datastore_active": True}]},
            ]}}
        if "datastore_search" in url:
            assert params["resource_id"] == "abc-123"
            return {"result": {"records": [
                {"factory_name": "מפעל כימי בע\"מ", "Lat": "32.10", "Long": "34.80", "כתובת": "רחוב התעשייה 5"},
                {"unrelated_field": "no coordinates here"},  # should be skipped
            ]}}
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr(environmental, "get_json", _fake_get_json)
    result = environmental.fetch_hazmat_sites()

    assert result["status"] == "ok"
    assert len(result["sites"]) == 1
    site = result["sites"][0]
    assert site["latitude"] == 32.10
    assert site["longitude"] == 34.80


def test_environmental_degrades_gracefully_when_dataset_not_found(monkeypatch):
    monkeypatch.setattr(environmental, "get_json", lambda *a, **k: {"result": {"results": []}})
    result = environmental.fetch_hazmat_sites()
    assert result == {"status": "unavailable", "sites": [], "source_system": "DATA-GOV-IL"}


def test_environmental_degrades_gracefully_on_network_failure(monkeypatch):
    monkeypatch.setattr(environmental, "get_json", _raise)
    result = environmental.fetch_hazmat_sites()
    assert result["status"] == "unavailable"


def test_environmental_sites_near_property_flags_within_radius():
    sites = [{"name": "מפעל", "latitude": 32.08, "longitude": 34.78, "address": None}]
    close = environmental.sites_near_property(sites, 32.0801, 34.7801)
    far = environmental.sites_near_property(sites, 31.0, 35.0)

    assert close["within_hazard_radius"] is True
    assert far["within_hazard_radius"] is False
    assert environmental.sites_near_property([], 32.08, 34.78)["nearest_site"] is None


def test_environmental_endpoints_require_gis_roles(client, make_user, make_property, monkeypatch):
    monkeypatch.setattr(environmental, "get_json", lambda *a, **k: {"result": {"results": []}})
    prop = make_property()
    risk_officer = make_user(role="RISK_OFFICER")
    field_worker = make_user(role="FIELD_WORKER")

    for path in (
        "/api/integrations/environmental/hazmat-sites",
        f"/api/integrations/environmental/property-hazmat-proximity?property_id={prop.property_id}",
    ):
        assert client.get(path).status_code == 401, path
        assert client.get(path, headers=auth_headers(field_worker)).status_code == 403, path
        assert client.get(path, headers=auth_headers(risk_officer)).status_code == 200, path


# ---------------------------------------------------------------------------
# gis.py — real OSM Nominatim reverse geocoding
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _fast_nominatim_rate_limit(monkeypatch):
    """Nominatim's real ~1 req/sec throttle (see gis.py) would make a test file
    calling reverse_geocode several times take several real seconds — harmless
    in production, unnecessary in tests, so the interval is collapsed to 0 and
    the shared last-call timestamp reset before each test."""
    monkeypatch.setattr(gis, "_min_interval_seconds", 0.0)
    monkeypatch.setattr(gis, "_last_call_monotonic", None)


def test_reverse_geocode_success(monkeypatch):
    monkeypatch.setattr(gis, "get_json", lambda *a, **k: {"display_name": "רחוב הרצל 1, תל אביב-יפו"})
    result = gis.reverse_geocode(32.08, 34.78)
    assert result == {"status": "ok", "address": "רחוב הרצל 1, תל אביב-יפו", "source_system": "OSM-NOMINATIM"}


def test_reverse_geocode_degrades_gracefully_on_network_failure(monkeypatch):
    monkeypatch.setattr(gis, "get_json", _raise)
    result = gis.reverse_geocode(32.08, 34.78)
    assert result == {"status": "unavailable", "address": None, "source_system": "OSM-NOMINATIM"}


def test_reverse_geocode_degrades_gracefully_on_empty_response(monkeypatch):
    monkeypatch.setattr(gis, "get_json", lambda *a, **k: {})
    result = gis.reverse_geocode(32.08, 34.78)
    assert result["status"] == "unavailable"


def test_reverse_geocode_endpoint_open_to_any_authenticated_role(client, make_user, monkeypatch):
    monkeypatch.setattr(gis, "get_json", lambda *a, **k: {"display_name": "כתובת לדוגמה"})
    field_worker = make_user(role="FIELD_WORKER")

    path = "/api/integrations/gis/reverse-geocode?latitude=32.08&longitude=34.78"
    assert client.get(path).status_code == 401
    resp = client.get(path, headers=auth_headers(field_worker))
    assert resp.status_code == 200
    assert resp.json()["address"] == "כתובת לדוגמה"
