"""data.gov.il hazmat/dangerous-materials sites connector — TODO_SPEC.md §12,
"אינטגרציה: מפעלי חומרים מסוכנים (Data.gov.il)".

Real call to Israel's national open-data portal, data.gov.il, which is built
on CKAN and exposes CKAN's standard, keyless "Action API"
(https://docs.ckan.org/en/latest/api/). Unlike the other four connectors in
this batch, this one doesn't have a single fixed, previously-known
resource_id to call directly — the hazmat/dangerous-materials dataset's
exact CKAN resource id isn't something this codebase had a prior contract
with, so `fetch_hazmat_sites` does what a real integration engineer would do
against an unfamiliar CKAN portal: search for the dataset by name via
`package_search`, then pull rows from its first datastore-active resource
via `datastore_search`. This two-step, self-discovering approach is more
resilient to data.gov.il re-publishing the dataset under a new resource id
than hardcoding one would be, at the cost of being slower and more failure-
prone than a direct call — both steps are wrapped so any failure (search
returns nothing, resource has no active datastore, unexpected field names)
degrades to an empty site list with `status="unavailable"`, never a 500.

Field names inside the actual CKAN rows aren't pinned down by a schema this
codebase controls either (a government open-data CSV's column headers are
whatever the publishing agency chose, often in Hebrew) — `_extract_site`
looks for coordinate/name fields by common-sense key-name heuristics rather
than one exact expected key, and skips any row it can't make sense of.

`sites_near_property` computes a real haversine distance (see
app/integrations/seismology.py for the same helper — a course-project-scale
duplication is fine here since these are two intentionally independent
connectors, not the same one) from a hazmat site to a single property, and
flags it within `_HAZARD_RADIUS_KM`. Read-only — nothing here writes to
Asset_Risk_Profiles.near_hazmat_site; the §13 automation that would set it
from this connector's output is explicitly out of this branch's scope.
"""
from __future__ import annotations

import logging
import math

from app.integrations._http import IntegrationFetchError, get_json

logger = logging.getLogger("rmis.integrations.environmental")

_CKAN_BASE_URL = "https://data.gov.il/api/3/action"

# Hebrew query terms tried in order against CKAN's package_search — "חומרים
# מסוכנים" (hazardous materials) is the term TODO_SPEC.md itself uses; the
# second is a common alternate phrasing for the same regulatory dataset.
_HAZMAT_DATASET_QUERIES = ("חומרים מסוכנים", "מפעלי סיכון")

# Distance (km) within which a property is considered "in the hazard radius"
# of a hazmat site — a deliberately simple fixed radius for this course demo,
# not a substance-specific hazard-modeling calculation.
_HAZARD_RADIUS_KM = 1.0

_EARTH_RADIUS_KM = 6371.0


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * _EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def _find_datastore_resource_id() -> str | None:
    """Step 1: search data.gov.il for a hazmat-sites dataset and return the
    first resource id that has an active CKAN datastore (i.e. is actually
    queryable via datastore_search, not just a downloadable file). Returns
    None if nothing matching was found or the search itself failed."""
    for query in _HAZMAT_DATASET_QUERIES:
        try:
            payload = get_json(f"{_CKAN_BASE_URL}/package_search", params={"q": query, "rows": 5})
        except IntegrationFetchError as exc:
            logger.warning("[DATA.GOV.IL] package_search(%r) failed: %s", query, exc)
            continue

        results = (payload or {}).get("result", {}).get("results", [])
        for dataset in results:
            for resource in dataset.get("resources", []):
                if resource.get("datastore_active"):
                    return resource.get("id")
    return None


def _extract_site(row: dict) -> dict | None:
    """Best-effort normalization of one CKAN datastore row into
    {name, latitude, longitude, address}. Government open-data column
    headers vary by dataset/publisher (often Hebrew, sometimes English) so
    this matches by common substrings rather than one exact key name; a row
    without a recognizable lat/long pair is skipped (returns None) rather
    than guessed at."""
    lat = lon = None
    name = address = None
    for key, value in row.items():
        key_lower = str(key).lower()
        if value in (None, ""):
            continue
        if lat is None and ("lat" in key_lower or key in ("y", "Y")):
            lat = _safe_float(value)
        elif lon is None and ("lon" in key_lower or "lng" in key_lower or key in ("x", "X")):
            lon = _safe_float(value)
        elif name is None and any(k in key_lower for k in ("name", "שם", "מפעל", "factory")):
            name = str(value)
        elif address is None and any(k in key_lower for k in ("address", "כתובת", "location")):
            address = str(value)

    if lat is None or lon is None:
        return None
    return {
        "name": name or "לא ידוע",
        "latitude": lat,
        "longitude": lon,
        "address": address,
    }


def _safe_float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def fetch_hazmat_sites(limit: int = 100) -> dict:
    """Real, self-discovering call to data.gov.il's CKAN Action API for a
    hazmat/dangerous-materials sites dataset — see module docstring for the
    two-step search-then-query approach and why. Returns `status="ok"` with
    whatever normalizable rows were found (possibly zero, if the dataset's
    current column layout doesn't match `_extract_site`'s heuristics), or
    `status="unavailable"` if the dataset couldn't be located/reached at
    all."""
    resource_id = _find_datastore_resource_id()
    if not resource_id:
        logger.warning("[DATA.GOV.IL] no datastore-active hazmat-sites resource found")
        return {"status": "unavailable", "sites": [], "source_system": "DATA-GOV-IL"}

    try:
        payload = get_json(f"{_CKAN_BASE_URL}/datastore_search", params={"resource_id": resource_id, "limit": limit})
    except IntegrationFetchError as exc:
        logger.warning("[DATA.GOV.IL] datastore_search(%s) failed: %s", resource_id, exc)
        return {"status": "unavailable", "sites": [], "source_system": "DATA-GOV-IL"}

    raw_records = (payload or {}).get("result", {}).get("records", [])
    sites = [s for s in (_extract_site(r) for r in raw_records) if s is not None]

    logger.info("[DATA.GOV.IL] fetched hazmat-sites dataset (resource=%s): %d/%d rows normalized",
                resource_id, len(sites), len(raw_records))
    return {"status": "ok", "sites": sites, "source_system": "DATA-GOV-IL"}


def sites_near_property(sites: list[dict], latitude: float, longitude: float) -> dict:
    """Given a list of hazmat sites (as returned by fetch_hazmat_sites), finds
    the nearest one to (latitude, longitude) and flags whether it's within
    `_HAZARD_RADIUS_KM`. Returns `{"within_hazard_radius": False,
    "nearest_site": None, "distance_km": None}` if `sites` is empty."""
    if not sites:
        return {"within_hazard_radius": False, "nearest_site": None, "distance_km": None}

    nearest = None
    nearest_km = None
    for site in sites:
        d = _haversine_km(latitude, longitude, site["latitude"], site["longitude"])
        if nearest_km is None or d < nearest_km:
            nearest_km, nearest = d, site

    return {
        "within_hazard_radius": nearest_km <= _HAZARD_RADIUS_KM,
        "nearest_site": nearest,
        "distance_km": round(nearest_km, 3) if nearest_km is not None else None,
    }
