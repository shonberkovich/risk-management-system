"""External weather-data connector.

Two modes, chosen automatically by whether `settings.openweathermap_api_key`
is set (same graceful-degradation convention as ANTHROPIC_API_KEY in
routers/ai.py — see config.py):

- **No key configured (default)**: falls back to `_fetch_weather_alerts_simulated`,
  the original "simulated" pattern also used by app/integrations/erp.py and
  app/integrations/gis.py — no outbound HTTP call. Kept so the course project
  still demos a live-looking weather feed on a laptop with no API key set up.
- **Key configured**: `_fetch_weather_alerts_real` calls OpenWeatherMap's free
  "Current Weather Data" endpoint (`/data/2.5/weather`, no paid subscription
  needed — unlike their One Call 3.0 endpoint, which is the one that ships an
  actual "alerts" array) once per active property, and derives an alert from
  the real current conditions returned (thunderstorm condition codes, wind
  speed, 1h rain volume, temperature) against fixed thresholds. This is a
  real external call, but it's an alert *derived from real current-conditions
  data* rather than a genuine government-issued weather warning — OpenWeatherMap's
  own alerts product isn't reachable on a free key.

The course brief (see docs/README.md §8, "מחבר נתוני מזג אוויר") asks for
extreme-weather alerts keyed to each property's location — the kind of thing
a real integration would poll from Israel's Meteorological Service (IMS) or a
commercial weather API on a schedule and use to pre-warn property managers
before a storm/flood/heatwave actually produces an `Incidents` row.

The simulated fallback differs from `gis.py` in one deliberate way:
`gis.fetch_risk_layers` simulates *static* geography (a flood-plain boundary
doesn't move day to day), so it hashes only `(latitude, longitude)` and is
stable forever. Weather is the opposite — the entire point of a weather
connector is that the same property can be calm today and under a storm
warning tomorrow. So `_fetch_weather_alerts_simulated` hashes
`(latitude, longitude, date)`: still deterministic (repeated calls on the
same day return the same simulated forecast, so the response doesn't
"flicker" mid-day), but the simulated alerts genuinely rotate as `as_of`
advances — call it again next week and a different subset of properties will
show alerts, the way a real forecast feed would.

Both modes share one shape: unlike `erp.py`/`gis.py` (which return one row
per property regardless of content — a book value, a flood-zone
classification, every property always has one), a weather-alerts feed only
emits alerts for locations actually under one; most days, most properties
have no active alert at all. Neither mode returns a "no alert" row for every
property, only for the ones that crossed a threshold.

Purely read-only in both modes — nothing here writes to `Incidents` or any
other table. Unlike `routers/incidents.py`'s `_trigger_critical_incident_ticket`
(which reacts to an incident that already happened), this module is a
*forecast*, before-the-fact input a risk manager would read on a dashboard —
wiring an alert into an automatic action (e.g. auto-creating a
`Mitigation_Tasks` follow-up) is a separate decision left to whoever consumes
this endpoint, not baked in here.
"""
import hashlib
import logging
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.integrations._http import IntegrationFetchError, get_json

logger = logging.getLogger("rmis.integrations.weather")

_OPENWEATHERMAP_BASE_URL = "https://api.openweathermap.org/data/2.5/weather"

# Thunderstorm condition codes (OpenWeatherMap's "Weather Condition Codes",
# group 2xx) — a real report of an active thunderstorm always counts as a
# STORM/WARNING regardless of the wind/rain thresholds below.
_THUNDERSTORM_CODE_RANGE = range(200, 300)

# (metric-unit threshold, severity) pairs, checked from most to least severe —
# the first one a reading meets/exceeds wins. Deliberately simple fixed
# thresholds for this course demo, not a meteorological alert model.
_WIND_SPEED_THRESHOLDS_MPS = [(20.0, "WARNING"), (14.0, "WATCH"), (10.0, "ADVISORY")]
_RAIN_1H_THRESHOLDS_MM = [(10.0, "WARNING"), (4.0, "WATCH")]
_HEATWAVE_TEMP_THRESHOLDS_C = [(40.0, "WARNING"), (37.0, "WATCH"), (34.0, "ADVISORY")]

# Alert types mirror schemas.HazardType where a weather event maps onto an
# existing hazard category (FLOOD), plus two weather-specific types RMIS's
# hazard taxonomy has no direct equivalent for.
_ALERT_TYPES = ["STORM", "FLOOD_WARNING", "HEATWAVE"]

_SEVERITIES = ["ADVISORY", "WATCH", "WARNING"]

# Simulated alert roll: only this fraction of (property, day) combinations
# produce an active alert — a real feed doesn't warn every property every
# day, most days are calm. Expressed as "must roll under this out of 100" on
# the stable hash below.
_ALERT_PROBABILITY_PERCENT = 20


def _stable_hash(*parts: str) -> int:
    """Deterministic, process-independent hash (unlike Python's salted built-in
    `hash()`) so the same property+day always yields the same simulated alert
    across calls within that day — there's no real weather API to ask twice."""
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def fetch_weather_alerts(
    db: Session,
    property_ids: list[int] | None = None,
    as_of: date | None = None,
) -> list[dict]:
    """Entry point routers/integrations.py calls — dispatches to the real
    OpenWeatherMap-backed fetch if `settings.openweathermap_api_key` is set,
    otherwise falls back to the simulated feed. See module docstring."""
    if settings.openweathermap_api_key:
        return _fetch_weather_alerts_real(db, property_ids=property_ids)
    return _fetch_weather_alerts_simulated(db, property_ids=property_ids, as_of=as_of)


def _classify_reading(weather_condition_id: int | None, wind_speed_mps: float | None, rain_1h_mm: float | None, temp_c: float | None) -> tuple[str, str] | None:
    """Maps one OpenWeatherMap current-conditions reading to (alert_type,
    severity), or None if nothing crossed a threshold. Checked in a fixed
    priority order (thunderstorm > wind > rain > heat) — a single reading
    only ever produces one alert, the most severe/specific one that applies,
    not one row per threshold it happens to cross."""
    if weather_condition_id is not None and weather_condition_id in _THUNDERSTORM_CODE_RANGE:
        return "STORM", "WARNING"

    if wind_speed_mps is not None:
        for threshold, severity in _WIND_SPEED_THRESHOLDS_MPS:
            if wind_speed_mps >= threshold:
                return "STORM", severity

    if rain_1h_mm is not None:
        for threshold, severity in _RAIN_1H_THRESHOLDS_MM:
            if rain_1h_mm >= threshold:
                return "FLOOD_WARNING", severity

    if temp_c is not None:
        for threshold, severity in _HEATWAVE_TEMP_THRESHOLDS_C:
            if temp_c >= threshold:
                return "HEATWAVE", severity

    return None


def _fetch_weather_alerts_real(db: Session, property_ids: list[int] | None = None) -> list[dict]:
    """Real call to OpenWeatherMap's free Current Weather Data endpoint, once
    per active property — see module docstring for why this derives an alert
    from current conditions rather than reading a real "alerts" array (that
    product requires OpenWeatherMap's paid One Call 3.0 subscription). A
    per-property fetch failure is logged and skipped, not raised — one flaky
    property must never fail the whole feed for every other property."""
    stmt = select(models.Property).where(models.Property.is_active == True)  # noqa: E712
    if property_ids:
        stmt = stmt.where(models.Property.property_id.in_(property_ids))
    properties = db.scalars(stmt.order_by(models.Property.property_id)).all()

    now_iso = datetime.utcnow().isoformat()
    alerts = []
    for prop in properties:
        lat, lon = float(prop.latitude), float(prop.longitude)
        try:
            payload = get_json(
                _OPENWEATHERMAP_BASE_URL,
                params={
                    "lat": lat,
                    "lon": lon,
                    "appid": settings.openweathermap_api_key,
                    "units": "metric",
                },
            )
        except IntegrationFetchError as exc:
            logger.warning("[OPENWEATHERMAP] fetch failed for property %s: %s", prop.property_code, exc)
            continue

        payload = payload or {}
        weather_list = payload.get("weather") or []
        condition_id = weather_list[0].get("id") if weather_list and isinstance(weather_list[0], dict) else None
        wind_speed = ((payload.get("wind") or {}).get("speed"))
        rain_1h = ((payload.get("rain") or {}).get("1h"))
        temp_c = ((payload.get("main") or {}).get("temp"))

        classification = _classify_reading(condition_id, wind_speed, rain_1h, temp_c)
        if classification is None:
            continue  # calm reading for this property — no alert emitted, matches a real feed
        alert_type, severity = classification

        alerts.append({
            "property_id": prop.property_id,
            "property_code": prop.property_code,
            "name": prop.name,
            "latitude": lat,
            "longitude": lon,
            "alert_type": alert_type,
            "severity": severity,
            "as_of": date.today().isoformat(),
            "issued_at": now_iso,
            "source_system": "OPENWEATHERMAP",
            "status": "ok",
        })

    logger.info(
        "[OPENWEATHERMAP] %d active alert(s) out of %d properties checked",
        len(alerts), len(properties),
    )
    return alerts


def _fetch_weather_alerts_simulated(
    db: Session,
    property_ids: list[int] | None = None,
    as_of: date | None = None,
) -> list[dict]:
    """Simulates a daily extreme-weather-alert feed for active properties,
    keyed to each property's (latitude, longitude, as_of date). Returns only
    the properties whose simulated forecast crossed the alert threshold for
    that day — most properties, most days, return nothing. See module
    docstring for why this hashes in the date (unlike gis.py's static
    flood-zone layer) and why "no alert" isn't a row."""
    as_of = as_of or date.today()

    stmt = select(models.Property).where(models.Property.is_active == True)  # noqa: E712
    if property_ids:
        stmt = stmt.where(models.Property.property_id.in_(property_ids))
    properties = db.scalars(stmt.order_by(models.Property.property_id)).all()

    day_key = as_of.isoformat()
    alerts = []
    for prop in properties:
        lat, lon = float(prop.latitude), float(prop.longitude)
        roll = _stable_hash("weather-roll", f"{lat:.6f}", f"{lon:.6f}", day_key) % 100
        if roll >= _ALERT_PROBABILITY_PERCENT:
            continue  # calm day for this property — no alert emitted, matches a real feed

        alert_type = _ALERT_TYPES[
            _stable_hash("weather-type", f"{lat:.6f}", f"{lon:.6f}", day_key) % len(_ALERT_TYPES)
        ]
        severity = _SEVERITIES[
            _stable_hash("weather-severity", f"{lat:.6f}", f"{lon:.6f}", day_key) % len(_SEVERITIES)
        ]

        alerts.append({
            "property_id": prop.property_id,
            "property_code": prop.property_code,
            "name": prop.name,
            "latitude": lat,
            "longitude": lon,
            "alert_type": alert_type,
            "severity": severity,
            "as_of": day_key,
            "issued_at": datetime.utcnow().isoformat(),
            "source_system": "WEATHER-SIM",
            "status": "simulated_alert",
        })

    logger.info(
        "[SIMULATED WEATHER PULL] %d active alert(s) out of %d properties checked (as_of %s)",
        len(alerts), len(properties), day_key,
    )
    return alerts
