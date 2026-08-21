"""Tests for app/integrations/weather.py's dual-mode dispatch (real
OpenWeatherMap connector when OPENWEATHERMAP_API_KEY is configured, simulated
feed otherwise). Every external call is mocked at the connector's own bound
`get_json` name (same convention as test_api_seismic_hazmat_automation.py) —
no live network access required.
"""
from __future__ import annotations

from app.config import settings
from app.integrations import weather
from app.integrations._http import IntegrationFetchError


def test_fetch_weather_alerts_uses_simulated_feed_without_api_key(db, make_property, monkeypatch):
    monkeypatch.setattr(settings, "openweathermap_api_key", "")

    def _fail_if_called(*args, **kwargs):
        raise AssertionError("get_json must not be called when no API key is configured")

    monkeypatch.setattr(weather, "get_json", _fail_if_called)
    make_property(latitude=32.08, longitude=34.78)

    # Simulated feed is deterministic but not guaranteed non-empty for every
    # property/day combo — the assertion here is just that it ran the
    # simulated path (no exception from the network-call guard above), not
    # that it returned a specific alert.
    result = weather.fetch_weather_alerts(db)
    assert isinstance(result, list)


def test_fetch_weather_alerts_calls_real_api_when_key_configured(db, make_property, monkeypatch):
    monkeypatch.setattr(settings, "openweathermap_api_key", "test-key")
    prop = make_property(latitude=32.08, longitude=34.78)

    calls = []

    def _fake_get_json(url, *, params=None, **kwargs):
        calls.append((url, params))
        return {
            "weather": [{"id": 200}],  # thunderstorm code -> STORM/WARNING
            "wind": {"speed": 2.0},
            "main": {"temp": 22.0},
        }

    monkeypatch.setattr(weather, "get_json", _fake_get_json)

    result = weather.fetch_weather_alerts(db, property_ids=[prop.property_id])

    assert len(calls) == 1
    assert calls[0][1]["appid"] == "test-key"
    assert len(result) == 1
    assert result[0]["property_id"] == prop.property_id
    assert result[0]["alert_type"] == "STORM"
    assert result[0]["severity"] == "WARNING"
    assert result[0]["source_system"] == "OPENWEATHERMAP"


def test_fetch_weather_alerts_real_skips_calm_reading(db, make_property, monkeypatch):
    monkeypatch.setattr(settings, "openweathermap_api_key", "test-key")
    make_property(latitude=32.08, longitude=34.78)

    monkeypatch.setattr(
        weather,
        "get_json",
        lambda *a, **k: {"weather": [{"id": 800}], "wind": {"speed": 1.0}, "main": {"temp": 20.0}},
    )

    assert weather.fetch_weather_alerts(db) == []


def test_fetch_weather_alerts_real_skips_property_on_fetch_failure(db, make_property, monkeypatch):
    monkeypatch.setattr(settings, "openweathermap_api_key", "test-key")
    make_property(latitude=32.08, longitude=34.78)

    def _raise(*args, **kwargs):
        raise IntegrationFetchError("simulated network failure")

    monkeypatch.setattr(weather, "get_json", _raise)

    # A per-property fetch failure degrades to an empty result for that
    # property, not a raised exception — see the module docstring.
    assert weather.fetch_weather_alerts(db) == []


def test_classify_reading_thresholds():
    assert weather._classify_reading(200, None, None, None) == ("STORM", "WARNING")
    assert weather._classify_reading(None, 21.0, None, None) == ("STORM", "WARNING")
    assert weather._classify_reading(None, 15.0, None, None) == ("STORM", "WATCH")
    assert weather._classify_reading(None, None, 11.0, None) == ("FLOOD_WARNING", "WARNING")
    assert weather._classify_reading(None, None, None, 41.0) == ("HEATWAVE", "WARNING")
    assert weather._classify_reading(None, 1.0, 0.0, 20.0) is None
