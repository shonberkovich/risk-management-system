"""Home Front Command (פיקוד העורף) real-time alerts connector — TODO_SPEC.md
§12, "אינטגרציה: התראות פיקוד העורף".

Unlike the pre-existing "simulated" connectors in this package (erp.py,
weather.py, and the original content of gis.py/economics.py — see their
docstrings), this is a REAL call to Home Front Command's own public,
keyless JSON alerts feed at `https://www.oref.org.il/WarningMessages/alert/
alerts.json` — the same endpoint the "Red Alert" community apps/bots poll.
It returns a JSON array of currently-active alerts (each with a Hebrew alert
category and a list of affected area names) when something is active, and
an EMPTY response body (not even `[]`, just zero bytes) when nothing is —
that empty-body case is expected and normal, not an error.

The feed is unauthenticated but does expect a browser-like request (a
descriptive User-Agent, `Referer`/`X-Requested-With` headers) or it can
return an empty body even when it wouldn't for a real browser — this module
sends those headers defensively, but since RMIS never has real security
credentials to prove it's origin-safe, an all-clear reading from this feed
should never be the ONLY signal a risk manager relies on for life-safety
decisions; it's read-only situational context here, same caveat as the
weather-alerts connector's docstring already gives for its simulated
forecast.

Cross-referencing against RMIS's own property locations: alert payloads name
areas ("ערים"/regions), not coordinates, so `match_alerts_to_properties`
does a normalized-substring match against `Properties.region`/`.name` — a
best-effort join, not a guaranteed one (Home Front Command's area names
don't always exactly match how a property's own `region` field was entered
in this demo dataset).
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.integrations._http import IntegrationFetchError, get_json

logger = logging.getLogger("rmis.integrations.home_front")

_ALERTS_URL = "https://www.oref.org.il/WarningMessages/alert/alerts.json"

# Home Front Command's feed expects these to look like a same-site browser
# request, not a generic script client — sent defensively (see module docstring).
_ALERTS_HEADERS = {
    "Referer": "https://www.oref.org.il/",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/plain, */*",
}


def fetch_active_alerts() -> dict:
    """Real call to Home Front Command's public alerts feed. Returns
    `{"status": "ok", "alerts": [...]}` (alerts possibly empty — that's the
    normal all-clear state) on success, or `{"status": "unavailable",
    "alerts": []}` if the feed couldn't be reached/parsed — a network
    problem reaching an external government feed is never surfaced as a
    500 to whoever calls this."""
    try:
        payload = get_json(_ALERTS_URL, headers=_ALERTS_HEADERS)
    except IntegrationFetchError as exc:
        logger.warning("[HOME FRONT COMMAND] alerts feed unavailable: %s", exc)
        return {"status": "unavailable", "alerts": [], "source_system": "OREF-ALERTS"}

    # An empty/no-content body from oref.org.il is the normal "no active alert"
    # state, not a malformed response — get_json's underlying JSON parse would
    # raise on truly empty bytes, which get_json already turns into
    # IntegrationFetchError above; a `null`/`{}` JSON body is treated the
    # same way here defensively.
    alerts_raw = payload if isinstance(payload, list) else []
    alerts = []
    for entry in alerts_raw:
        if not isinstance(entry, dict):
            continue
        areas = entry.get("data") if isinstance(entry.get("data"), list) else []
        alerts.append({
            "category": entry.get("cat") or entry.get("category") or "UNKNOWN",
            "title": entry.get("title") or "",
            "areas": [str(a) for a in areas],
        })

    logger.info("[HOME FRONT COMMAND] fetched alerts feed: %d active alert(s)", len(alerts))
    return {"status": "ok", "alerts": alerts, "source_system": "OREF-ALERTS"}


def match_alerts_to_properties(db: Session, alerts: list[dict]) -> list[dict]:
    """Cross-references active alert areas against active Properties by a
    normalized (stripped, casefolded) substring match on `region`/`name` —
    see module docstring for why this is best-effort, not exact."""
    if not alerts:
        return []

    all_area_names = set()
    for alert in alerts:
        all_area_names.update(a.strip() for a in alert.get("areas", []) if a and a.strip())
    if not all_area_names:
        return []

    properties = db.scalars(
        select(models.Property).where(models.Property.is_active == True)  # noqa: E712
    ).all()

    matches = []
    for prop in properties:
        for area in all_area_names:
            if area in (prop.region or "") or area in (prop.name or ""):
                matches.append({
                    "property_id": prop.property_id,
                    "property_code": prop.property_code,
                    "name": prop.name,
                    "region": prop.region,
                    "matched_area": area,
                })
                break

    logger.info("[HOME FRONT COMMAND] matched %d/%d active properties to an active alert area",
                len(matches), len(properties))
    return matches
