"""Geological Survey of Israel (GSI, המכון הגיאולוגי — אגף הסייסמולוגיה)
real-time earthquake connector — TODO_SPEC.md §12, "אינטגרציה: המכון
הגיאולוגי (רעידות אדמה)".

Real call (see app/integrations/_http.py's module docstring for why this
package now mixes real connectors alongside the pre-existing simulated
ones) to GSI's public seismology bulletin. GSI publishes its recent-events
list as a plain-text, whitespace/comma-delimited table (no API key, no
JSON) at a stable public URL under eq.gsi.gov.il — this module fetches it
as text and parses the columns defensively (see `_parse_bulletin_line`):
DateTime, Latitude, Longitude, Depth(km), Magnitude, Region. If GSI ever
changes the bulletin's exact column layout, or the endpoint is unreachable
from this sandboxed dev environment, `fetch_recent_earthquakes` degrades to
an empty list with `status="unavailable"` rather than raising — same
graceful-degradation convention as the rest of this batch.

`nearest_properties_to_epicenter` is the other half TODO_SPEC.md §12 asks
for: a real haversine great-circle distance from an earthquake's epicenter
to every active property's `(latitude, longitude)`, sorted nearest-first.
Read-only — nothing here writes an Incidents draft; that automation
(TODO_SPEC.md §13, "אוטומציה: פתיחת טיוטת אירוע בעקבות רעידת אדמה") is
explicitly out of this branch's scope and is left for routers/incidents.py
to call this module's output.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.integrations._http import IntegrationFetchError, get_text

logger = logging.getLogger("rmis.integrations.seismology")

# GSI's public "last N events" bulletin — plain text, one event per line,
# comma-separated: DateTime, Lat, Long, Depth(km), Magnitude, Region.
_BULLETIN_URL = "https://eq.gsi.gov.il/en/earthquake/files/last50eq.txt"

# Earth's mean radius in km, for the haversine distance calc below.
_EARTH_RADIUS_KM = 6371.0


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two (lat, lon) points in km."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def _parse_bulletin_line(line: str) -> dict | None:
    """Parses one line of GSI's comma-separated bulletin into a normalized
    event dict, or None if the line doesn't look like a data row (header
    line, blank line, or an unexpected column count — tolerated, not
    fatal: one malformed row just gets skipped rather than aborting the
    whole feed)."""
    parts = [p.strip() for p in line.strip().split(",")]
    if len(parts) < 5:
        return None
    try:
        event_time = parts[0]
        latitude = float(parts[1])
        longitude = float(parts[2])
        depth_km = float(parts[3])
        magnitude = float(parts[4])
        region = parts[5] if len(parts) > 5 else ""
    except (ValueError, IndexError):
        return None
    return {
        "event_time": event_time,
        "latitude": latitude,
        "longitude": longitude,
        "depth_km": depth_km,
        "magnitude": magnitude,
        "region": region,
    }


def fetch_recent_earthquakes(limit: int = 20) -> dict:
    """Real call to GSI's public seismology bulletin. Returns up to `limit`
    most-recent parsed events (bulletin is already newest-first) plus a
    `status` field — `"ok"` on a successful fetch (events possibly empty if
    GSI genuinely has nothing recent), `"unavailable"` if the feed couldn't
    be reached or parsed at all."""
    try:
        raw_text = get_text(_BULLETIN_URL)
    except IntegrationFetchError as exc:
        logger.warning("[GSI SEISMOLOGY] bulletin unavailable: %s", exc)
        return {"status": "unavailable", "events": [], "source_system": "GSI-SEISMOLOGY"}

    events = []
    for line in raw_text.splitlines():
        parsed = _parse_bulletin_line(line)
        if parsed:
            events.append(parsed)
        if len(events) >= limit:
            break

    logger.info("[GSI SEISMOLOGY] fetched bulletin: %d event(s) parsed", len(events))
    return {"status": "ok" if events or raw_text.strip() == "" else "unavailable",
            "events": events, "source_system": "GSI-SEISMOLOGY"}


def nearest_properties_to_epicenter(db: Session, latitude: float, longitude: float) -> list[dict]:
    """Real haversine distance from one earthquake epicenter to every active
    property, sorted nearest-first. `felt_locally` flags properties within
    `_FELT_RADIUS_KM` — a rough magnitude-agnostic "worth a manual look"
    threshold, not a seismological felt-intensity calculation."""
    _felt_radius_km = 100.0
    properties = db.scalars(
        select(models.Property).where(models.Property.is_active == True)  # noqa: E712
    ).all()

    rows = []
    for prop in properties:
        distance_km = round(_haversine_km(latitude, longitude, float(prop.latitude), float(prop.longitude)), 2)
        rows.append({
            "property_id": prop.property_id,
            "property_code": prop.property_code,
            "name": prop.name,
            "distance_km": distance_km,
            "felt_locally": distance_km <= _felt_radius_km,
        })

    rows.sort(key=lambda r: r["distance_km"])
    return rows
