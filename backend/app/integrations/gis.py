"""External GIS connector (Govmap / Mapbox layers). Same "simulated" pattern as
app/integrations/erp.py and app/services/notifications.py: no real API key in
`backend/.env`, no outbound HTTP call, no network dependency.

The course brief (see docs/README.md §8, "מחבר GIS חיצוני (Govmap / Mapbox
Layers)") asks for flood-zone and climate-risk *layers* — i.e. an external,
independent classification of a property's location, the way Govmap's
"מפת הצפות" (flood-hazard map) or a Mapbox climate-risk tileset would return
one for a given lat/long. This is deliberately NOT the same thing
`frontend/src/components/RiskMap.tsx` already draws with its "אזורי הצפה"
toggle: that circle is only a visualization of `Asset_Risk_Profiles
.flood_risk_score`, RMIS's own internal survey data, radius-scaled around the
property pin. It has no relationship to an actual flood-plain boundary and
can't tell a risk manager when the internal survey score is stale or wrong.

`fetch_risk_layers` closes that gap: for each active property it derives an
external-looking flood-zone classification and a climate-risk index purely
from the property's `(latitude, longitude)` — since there is no real Govmap/
Mapbox key to call, the "external" values are computed deterministically with
a stable hash of the coordinates (same property always yields the same
simulated layer value, so repeated calls don't "flicker"; this mirrors how
`erp.pull_asset_book_values` recomputes from scratch on every call instead of
caching a stale answer). Unlike `pull_asset_book_values` — which explicitly
avoids comparing against RMIS's own numbers because there's no real external
system to disagree with — this module DOES compare: it joins each property's
`Asset_Risk_Profiles.flood_risk_score` and flags a `mismatch` when the
internal survey score and the simulated external flood-zone classification
disagree by more than `_MISMATCH_THRESHOLD`. That comparison is the actual
point of a flood-zone connector (surfacing "the external map disagrees with
our last survey, go re-survey this property"), so it stays even though the
same caution from erp.py still applies: nothing here writes back to
`Asset_Risk_Profiles` (no `gis_last_synced_at` column exists in the schema to
persist that a mismatch was reviewed/resolved), so a mismatch simply
resurfaces on every call until someone updates the underlying survey.
"""
import hashlib
import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models

logger = logging.getLogger("rmis.integrations.gis")

# FEMA-style zone letters, ordered low → high hazard, the way Govmap's flood
# layer legend groups them. Index into this list IS the simulated 0-3 flood
# score used for the mismatch comparison against Asset_Risk_Profiles
# .flood_risk_score (which is itself a 1-10 field survey score — scaled by
# _INTERNAL_SCORE_TO_ZONE_DIVISOR below so the two scales are comparable).
_FLOOD_ZONES = [
    ("X", "אזור סיכון נמוך — מחוץ לתחום ההצפה הסטטיסטי (100 שנה)"),
    ("B", "אזור סיכון מתון — סמוך לאפיק ניקוז או תוואי נחל עונתי"),
    ("A", "אזור סיכון גבוה — בתוך תחום הצפה של 100 שנה"),
    ("AE", "אזור סיכון גבוה עם מפלס הצפה קבוע (Base Flood Elevation) מוגדר"),
]

# Climate-risk index is reported on a simulated 0-100 scale (heat-stress +
# drought-exposure composite), the shape a Mapbox climate-risk tileset query
# would return for a point.
_CLIMATE_INDEX_MAX = 100

# Asset_Risk_Profiles.flood_risk_score is a 1-10 field-survey score; divide by
# this to land it on the same 0-3 zone-index scale as _FLOOD_ZONES for the
# mismatch comparison.
_INTERNAL_SCORE_TO_ZONE_DIVISOR = 3

# How many zone-index steps the internal survey and the simulated external
# layer may disagree by before it's flagged as a mismatch worth re-surveying.
_MISMATCH_THRESHOLD = 1


def _stable_hash(*parts: str) -> int:
    """Deterministic, process-independent hash (unlike Python's salted built-in
    `hash()`) so the same property always yields the same simulated layer
    value across calls/restarts — there's no real GIS backend to ask twice."""
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def _simulated_flood_zone_index(latitude: float, longitude: float) -> int:
    return _stable_hash("flood", f"{latitude:.6f}", f"{longitude:.6f}") % len(_FLOOD_ZONES)


def _simulated_climate_index(latitude: float, longitude: float) -> int:
    return _stable_hash("climate", f"{latitude:.6f}", f"{longitude:.6f}") % (_CLIMATE_INDEX_MAX + 1)


def fetch_risk_layers(db: Session, property_ids: list[int] | None = None) -> list[dict]:
    """Simulates a Govmap flood-zone layer + a Mapbox climate-risk layer lookup
    for each active property's coordinates, and cross-checks the flood-zone
    result against the property's own `Asset_Risk_Profiles.flood_risk_score`.
    Returns one row per property; see module docstring for why the mismatch
    comparison exists here but not in erp.py's pull function, and why nothing
    is written back."""
    stmt = (
        select(models.Property, models.AssetRiskProfile)
        .outerjoin(models.AssetRiskProfile, models.AssetRiskProfile.property_id == models.Property.property_id)
        .where(models.Property.is_active == True)  # noqa: E712
    )
    if property_ids:
        stmt = stmt.where(models.Property.property_id.in_(property_ids))

    rows = []
    for prop, profile in db.execute(stmt.order_by(models.Property.property_id)).all():
        lat, lon = float(prop.latitude), float(prop.longitude)
        zone_index = _simulated_flood_zone_index(lat, lon)
        zone_code, zone_description = _FLOOD_ZONES[zone_index]
        climate_index = _simulated_climate_index(lat, lon)

        internal_score = profile.flood_risk_score if profile else None
        mismatch = False
        if internal_score is not None:
            internal_zone_index = round(internal_score / _INTERNAL_SCORE_TO_ZONE_DIVISOR)
            mismatch = abs(internal_zone_index - zone_index) > _MISMATCH_THRESHOLD

        rows.append({
            "property_id": prop.property_id,
            "property_code": prop.property_code,
            "name": prop.name,
            "latitude": lat,
            "longitude": lon,
            "flood_zone": zone_code,
            "flood_zone_description": zone_description,
            "climate_risk_index": climate_index,
            "internal_flood_risk_score": internal_score,
            "mismatch_with_internal_survey": mismatch,
            "source_system": "GIS-SIM",
            "as_of": datetime.utcnow().isoformat(),
            "status": "simulated_layer",
        })

    mismatches = sum(1 for r in rows if r["mismatch_with_internal_survey"])
    logger.info(
        "[SIMULATED GIS PULL] fetched flood/climate layers for %d properties (%d flagged as mismatched vs. internal survey)",
        len(rows), mismatches,
    )
    return rows
