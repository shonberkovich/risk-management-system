"""External weather-data connector. Same "simulated" pattern as
app/integrations/erp.py and app/integrations/gis.py: no real provider key in
`backend/.env` (no IMS/OpenWeather/Tomorrow.io account), no outbound HTTP
call.

The course brief (see docs/README.md §8, "מחבר נתוני מזג אוויר") asks for
extreme-weather alerts keyed to each property's location — the kind of thing
a real integration would poll from Israel's Meteorological Service (IMS) or a
commercial weather API on a schedule and use to pre-warn property managers
before a storm/flood/heatwave actually produces an `Incidents` row.

This module differs from `gis.py` in one deliberate way: `gis.fetch_risk_layers`
simulates *static* geography (a flood-plain boundary doesn't move day to day),
so it hashes only `(latitude, longitude)` and is stable forever. Weather is
the opposite — the entire point of a weather connector is that the same
property can be calm today and under a storm warning tomorrow. So
`fetch_weather_alerts` hashes `(latitude, longitude, date)`: still
deterministic (repeated calls on the same day return the same simulated
forecast, so the response doesn't "flicker" mid-day), but the simulated
alerts genuinely rotate as `as_of` advances — call it again next week and a
different subset of properties will show alerts, the way a real forecast
feed would.

A second difference from both `erp.py` and `gis.py`: those two return one row
per property regardless of content (a book value, a flood-zone classification
— every property always has one). A real weather-alerts feed doesn't work
that way — it only emits alerts for locations actually under one; most days,
most properties have no active alert at all. `fetch_weather_alerts` mirrors
that: it only returns rows for properties whose simulated forecast crossed
the alert threshold, not a "no alert" row for every property.

Purely read-only like the two connectors above — nothing here writes to
`Incidents` or any other table. Unlike `routers/incidents.py`'s
`_trigger_critical_incident_ticket` (which reacts to an incident that already
happened), this module is a *forecast*, before-the-fact input a risk manager
would read on a dashboard — wiring an alert into an automatic action (e.g.
auto-creating a `Mitigation_Tasks` follow-up) is a separate decision left to
whoever consumes this endpoint, not baked in here.
"""
import hashlib
import logging
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models

logger = logging.getLogger("rmis.integrations.weather")

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
