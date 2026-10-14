"""External Data Agent (TODO_SPEC.md §4) — a macro-risk analyst agent that
only ever sees the outside world through the existing `app/integrations/*`
modules (weather, seismology, hazmat/GIS, BOI economics). Tools here are thin
text-formatting wrappers around those modules' functions — no new external
calls are introduced, matching services/llm.py's ASK_TOOLS pattern (the model
picks a tool + params, never generates a request itself).

Registers its prompt + tools as `EXTERNAL_DATA_AGENT` in
`ai_orchestrator.AGENT_TOOLS` on import (see `register_agent_tools`)."""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from anthropic import beta_tool

from app.database import SessionLocal
from app.integrations import economics, gis, seismology, weather
from app.services import ai_orchestrator

logger = logging.getLogger("rmis.agents.external_data")

SYSTEM_PROMPT = """אתה אנליסט סיכוני מאקרו במערכת RMIS לניהול סיכונים.
תפקידך לאסוף נתוני מאקרו חיצוניים (מזג אוויר קיצוני, רעידות אדמה, אתרי חומרים מסוכנים בסביבת נכסים,
ומדדים כלכליים כמו שערי חליפין ואינפלציה) באמצעות הכלים שברשותך, ולנתח אותם מנקודת מבט של חשיפת סיכון
לתיק הנכסים של החברה. ענה תמיד בעברית, בתמציתיות ובבהירות, והתבסס אך ורק על תוצאות הכלים - אל תמציא נתונים.
אם מקור נתונים מסוים אינו זמין כרגע (status="unavailable"), ציין זאת במפורש במקום להתעלם מכך."""


@beta_tool
def get_weather_alerts(property_ids: str = "") -> str:
    """Returns today's simulated extreme-weather alerts for active properties.
    property_ids: optional comma-separated list of property IDs to filter to."""
    db = SessionLocal()
    try:
        ids = [int(x) for x in property_ids.split(",") if x.strip()] or None
        alerts = weather.fetch_weather_alerts(db, property_ids=ids)
        if not alerts:
            return "אין התרעות מזג אוויר קיצוני פעילות היום עבור הנכסים המבוקשים."
        return "\n".join(
            f"{a.get('name', a.get('property_id'))}: התרעת {a.get('alert_type')}, "
            f"חומרה={a.get('severity')}"
            for a in alerts
        )
    finally:
        db.close()


@beta_tool
def get_recent_earthquakes(limit: int = 10) -> str:
    """Returns the most recent seismology bulletin events from GSI (Geological
    Survey of Israel), newest first."""
    result = seismology.fetch_recent_earthquakes(limit=limit)
    if result["status"] != "ok":
        return "נתוני רעידות האדמה מ-GSI אינם זמינים כרגע."
    if not result["events"]:
        return "לא נרשמו רעידות אדמה משמעותיות לאחרונה."
    return "\n".join(
        f"מגניטודה={e.get('magnitude')}, אזור={e.get('region') or 'לא ידוע'}, "
        f"זמן={e.get('event_time', '')}"
        for e in result["events"]
    )


@beta_tool
def get_earthquake_exposure(latitude: float, longitude: float) -> str:
    """Given an earthquake epicenter's latitude/longitude, returns which
    company properties are nearest to it and which are within the
    "felt locally" radius — for assessing which assets to check first."""
    db = SessionLocal()
    try:
        rows = seismology.nearest_properties_to_epicenter(db, latitude, longitude)
        if not rows:
            return "אין נכסים פעילים לבדיקה."
        felt = [r for r in rows if r.get("felt_locally")]
        lines = [f"{len(felt)} נכסים בטווח שעלול להיות מורגש מקרוב לאפיצנטר:"]
        lines += [
            f"{r.get('name')}: מרחק={r.get('distance_km'):.1f} ק\"מ" for r in rows[:5]
        ]
        return "\n".join(lines)
    finally:
        db.close()


@beta_tool
def get_hazmat_and_flood_exposure(property_ids: str = "") -> str:
    """Returns each property's simulated flood-zone/climate-risk GIS layer,
    including whether it mismatches the property's own internal survey score.
    property_ids: optional comma-separated list of property IDs to filter to."""
    db = SessionLocal()
    try:
        ids = [int(x) for x in property_ids.split(",") if x.strip()] or None
        rows = gis.fetch_risk_layers(db, property_ids=ids)
        if not rows:
            return "לא נמצאו נכסים לבדיקה."
        return "\n".join(
            f"{r['name']}: אזור הצפה={r['flood_zone']} ({r['flood_zone_description']}), "
            f"מדד אקלים={r['climate_risk_index']}"
            + (", ⚠️ אי-התאמה מול הסקר הפנימי" if r.get("mismatch_with_internal_survey") else "")
            for r in rows
        )
    finally:
        db.close()


@beta_tool
def get_economic_indicators() -> str:
    """Returns current macroeconomic indicators from the Bank of Israel
    (USD/EUR exchange rates, year-over-year CPI/inflation)."""
    result = economics.fetch_boi_market_data()
    lines = [f"נכון ל-{result['as_of']}:"]
    for row in result["series"]:
        if row["status"] == "ok":
            lines.append(f"{row['series']}: {row['value']} ({row['unit']})")
        else:
            lines.append(f"{row['series']}: לא זמין")
    return "\n".join(lines)


DATA_AGENT_TOOLS = [
    get_weather_alerts,
    get_recent_earthquakes,
    get_earthquake_exposure,
    get_hazmat_and_flood_exposure,
    get_economic_indicators,
]


# Chat snapshot of the portfolio-wide external feeds (weather alerts, recent
# earthquakes, BOI indicators). They're slow live calls (~0.8-1.1s each), so
# they're never fetched on a chat request's critical path: the snapshot is
# served from memory and refreshed in the background once it's older than
# _SNAPSHOT_TTL_SECONDS (stale-while-revalidate). Before the first refresh
# finishes it's empty and the model just calls the tools as before.
_SNAPSHOT_TTL_SECONDS = 300
_SNAPSHOT_SOURCES = [
    ("התרעות מזג אוויר", get_weather_alerts),
    ("רעידות אדמה אחרונות", get_recent_earthquakes),
    ("מדדים כלכליים", get_economic_indicators),
]
_snapshot_lock = threading.Lock()
_snapshot_text = ""
_snapshot_at = 0.0
_snapshot_refreshing = False


def _refresh_external_snapshot() -> None:
    global _snapshot_text, _snapshot_at, _snapshot_refreshing
    try:
        with ThreadPoolExecutor(max_workers=len(_SNAPSHOT_SOURCES)) as pool:
            results = list(pool.map(lambda source: source[1].call({}), _SNAPSHOT_SOURCES))
        _snapshot_text = "\n".join(f"{title}:\n{text}" for (title, _), text in zip(_SNAPSHOT_SOURCES, results))
        _snapshot_at = time.monotonic()
    except Exception:  # noqa: BLE001 — a failed refresh just leaves the old snapshot in place
        logger.exception("external data snapshot refresh failed")
    finally:
        _snapshot_refreshing = False


def external_snapshot() -> str:
    global _snapshot_refreshing
    with _snapshot_lock:
        if time.monotonic() - _snapshot_at >= _SNAPSHOT_TTL_SECONDS and not _snapshot_refreshing:
            _snapshot_refreshing = True
            threading.Thread(target=_refresh_external_snapshot, name="external-snapshot", daemon=True).start()
    return _snapshot_text


ai_orchestrator.register_agent_tools("EXTERNAL_DATA_AGENT", SYSTEM_PROMPT, DATA_AGENT_TOOLS, snapshot=external_snapshot)
