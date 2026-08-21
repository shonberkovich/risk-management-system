"""Tests for app/integrations/economics.py's real-CBS-first, simulated-fallback
dispatch for `fetch_index_series`/`fetch_replacement_value_updates` (see that
module's docstring). Every external call is mocked at the connector's own
bound `get_json` name (same convention as test_api_integrations_external.py)
— no live network access required.
"""
from __future__ import annotations

from datetime import date

from app.integrations import economics
from app.integrations._http import IntegrationFetchError


def _cbs_payload(rows: list[tuple[int, int, float, str]]) -> dict:
    """Builds a minimal CBS `/index/data/price` response shape from a list of
    (year, month, value, base_desc) tuples."""
    return {
        "month": [{
            "date": [
                {"year": year, "month": month, "currBase": {"baseDesc": base_desc, "value": value}}
                for year, month, value, base_desc in rows
            ],
        }],
    }


_CPI_ROWS = [(2026, 7, 105.1, "2024 ממוצע"), (2026, 6, 104.8, "2024 ממוצע")]
_CONSTRUCTION_ROWS = [(2026, 7, 103.5, "2025 יולי"), (2025, 1, 100.0, "2025 יולי")]


def test_fetch_index_series_uses_real_cbs_data(monkeypatch):
    def _fake_get_json(url, *, params=None, **kwargs):
        if params["id"] == economics._CBS_CPI_SERIES_ID:
            return _cbs_payload(_CPI_ROWS)
        if params["id"] == economics._CBS_CONSTRUCTION_SERIES_ID:
            return _cbs_payload(_CONSTRUCTION_ROWS)
        raise AssertionError(f"unexpected series id {params['id']}")

    monkeypatch.setattr(economics, "get_json", _fake_get_json)

    result = economics.fetch_index_series(as_of=date(2026, 7, 15))

    assert result["source_system"] == "CBS-PUBLIC-API"
    assert result["cpi_index"] == 105.1
    assert result["construction_cost_index"] == 103.5
    assert result["base_date"] == "2025-07-01"  # parsed from "2025 יולי"


def test_fetch_index_series_falls_back_to_simulated_on_cbs_failure(monkeypatch):
    def _raise(*args, **kwargs):
        raise IntegrationFetchError("simulated network failure")

    monkeypatch.setattr(economics, "get_json", _raise)

    result = economics.fetch_index_series(as_of=date(2026, 7, 15))

    assert result["source_system"] == "ECON-SIM"
    assert isinstance(result["construction_cost_index"], float)
    assert isinstance(result["cpi_index"], float)


def test_fetch_replacement_value_updates_uses_real_cbs_data(db, make_property, monkeypatch):
    prop = make_property(replacement_value=1_000_000)

    def _fake_get_json(url, *, params=None, **kwargs):
        assert params["id"] == economics._CBS_CONSTRUCTION_SERIES_ID
        return _cbs_payload(_CONSTRUCTION_ROWS)

    monkeypatch.setattr(economics, "get_json", _fake_get_json)

    rows = economics.fetch_replacement_value_updates(db, property_ids=[prop.property_id], as_of=date(2026, 7, 15))

    assert len(rows) == 1
    row = rows[0]
    assert row["source_system"] == "CBS-PUBLIC-API"
    assert row["status"] == "ok"
    # current index (103.5) vs baseline index resolved from the property's
    # updated_at month, both from the real (mocked) CBS series above.
    assert row["current_replacement_value"] == 1_000_000.0


def test_fetch_replacement_value_updates_falls_back_to_simulated_on_cbs_failure(db, make_property, monkeypatch):
    prop = make_property(replacement_value=1_000_000)

    def _raise(*args, **kwargs):
        raise IntegrationFetchError("simulated network failure")

    monkeypatch.setattr(economics, "get_json", _raise)

    rows = economics.fetch_replacement_value_updates(db, property_ids=[prop.property_id], as_of=date(2026, 7, 15))

    assert len(rows) == 1
    assert rows[0]["source_system"] == "ECON-SIM"
    assert rows[0]["status"] == "simulated_index"


def test_parse_cbs_base_desc():
    assert economics._parse_cbs_base_desc("2025 יולי") == date(2025, 7, 1)
    assert economics._parse_cbs_base_desc("2024 ממוצע") is None  # not a "<year> <month>" shape
    assert economics._parse_cbs_base_desc(None) is None


def test_closest_cbs_row_prefers_at_or_before_target():
    months = [
        {"year": 2026, "month": 5, "value": 1.0},
        {"year": 2026, "month": 7, "value": 2.0},
        {"year": 2026, "month": 9, "value": 3.0},
    ]
    # Exactly between June and August (both 1 month away) — at-or-before (July) wins.
    assert economics._closest_cbs_row(months, date(2026, 8, 1))["value"] == 2.0
