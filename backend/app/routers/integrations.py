from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import require_roles
from app.integrations import economics, environmental, erp, gis, home_front, seismology, weather

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

# Same write-role set as policies/claims: finance-facing data, not a field-worker concern.
_ERP_ROLES = ("RISK_MANAGER", "CFO", "ADMIN")

# Flood-zone/climate layers feed risk assessment, not finance — same role set
# already used for risk-scoring/survey endpoints, not the ERP one above.
# Reused as-is (TODO_SPEC.md §12) for the new seismology.py and environmental.py
# connectors — both are risk-assessment inputs, same as the flood/climate layers.
_GIS_ROLES = ("RISK_MANAGER", "RISK_OFFICER", "ADMIN")

# Weather alerts are an operational/field-facing warning (a property manager
# or field worker needs to know a storm is coming, not just risk officers) —
# open to any authenticated role, same as incident reporting.

# Replacement-value/index data feeds revaluation decisions — same finance-
# facing role set as the ERP endpoints above, not the risk-assessment one.
_ECONOMICS_ROLES = ("RISK_MANAGER", "CFO", "ADMIN")


@router.get("/erp/book-values", response_model=list[schemas.ErpBookValueOut])
def get_erp_book_values(
    property_id: list[int] | None = Query(default=None),
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_ERP_ROLES)),
):
    """Simulated ERP fixed-assets export — see app/integrations/erp.py for why
    this doesn't hit a real ERP and doesn't overwrite Properties.book_value."""
    return erp.pull_asset_book_values(db, property_ids=property_id)


@router.post("/erp/post-claim-receipts", response_model=list[schemas.ErpClaimReceiptPostingOut])
def post_erp_claim_receipts(
    since: date | None = Query(default=None),
    claim_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_ERP_ROLES)),
):
    """Builds AR journal-entry postings from Claim_Payments and "posts" them to
    the simulated ERP ledger. Stateless — see app/integrations/erp.py docstring
    for why there's no posted-flag to avoid re-posting on repeated calls."""
    return erp.post_claim_receipts(db, since=since, claim_id=claim_id)


@router.get("/gis/risk-layers", response_model=list[schemas.GisRiskLayerOut])
def get_gis_risk_layers(
    property_id: list[int] | None = Query(default=None),
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_GIS_ROLES)),
):
    """Simulated Govmap flood-zone layer + Mapbox climate-risk layer lookup,
    cross-checked against Asset_Risk_Profiles.flood_risk_score — see
    app/integrations/gis.py for why this doesn't hit a real GIS API and why a
    mismatch isn't persisted anywhere."""
    return gis.fetch_risk_layers(db, property_ids=property_id)


@router.get("/weather/alerts", response_model=list[schemas.WeatherAlertOut])
def get_weather_alerts(
    property_id: list[int] | None = Query(default=None),
    as_of: date | None = Query(default=None),
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles()),
):
    """Simulated extreme-weather-alert feed (storm/flood/heatwave) per property
    location — see app/integrations/weather.py for why this doesn't hit a real
    weather API and why calm properties simply don't appear in the response.
    Open to any authenticated role: a field worker at a property needs this
    warning as much as a risk officer does."""
    return weather.fetch_weather_alerts(db, property_ids=property_id, as_of=as_of)


@router.get("/economics/index-series", response_model=schemas.EconomicIndexSeriesOut)
def get_economic_index_series(
    as_of: date | None = Query(default=None),
    _user: models.User = Depends(require_roles(*_ECONOMICS_ROLES)),
):
    """Simulated construction-cost index + CPI for the given month (default:
    today) — see app/integrations/economics.py for why this doesn't hit a
    real Central Bureau of Statistics / Bank of Israel API."""
    return economics.fetch_index_series(as_of=as_of)


@router.get("/economics/replacement-value-updates", response_model=list[schemas.ReplacementValueUpdateOut])
def get_replacement_value_updates(
    property_id: list[int] | None = Query(default=None),
    as_of: date | None = Query(default=None),
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_ECONOMICS_ROLES)),
):
    """Recommends an inflation/construction-cost-adjusted replacement value
    per property, flagging drift beyond the revaluation threshold — see
    app/integrations/economics.py for why nothing is written back to
    Properties.replacement_value."""
    return economics.fetch_replacement_value_updates(db, property_ids=property_id, as_of=as_of)


@router.get("/economics/boi-market-data", response_model=schemas.BoiMarketDataOut)
def get_boi_market_data(
    _user: models.User = Depends(require_roles(*_ECONOMICS_ROLES)),
):
    """Real Bank of Israel PublicApi call (USD/EUR exchange rates + latest
    published y/y inflation reading) — see app/integrations/economics.py's
    module-level comment for exactly what's real here, why it's added onto
    the pre-existing simulated construction-cost-index module rather than a
    new file, and why an unreachable/changed BOI endpoint degrades each
    series to status="unavailable" instead of failing the whole request."""
    return economics.fetch_boi_market_data()


@router.get("/home-front/alerts", response_model=schemas.HomeFrontAlertsOut)
def get_home_front_alerts(
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles()),
):
    """Real Home Front Command (פיקוד העורף) public alerts feed, cross-
    referenced against active Properties — see
    app/integrations/home_front.py for why this is a best-effort area-name
    match, not a guaranteed one, and why an empty `alerts` list is the
    normal all-clear state, not an error. Open to any authenticated role —
    safety information takes priority over role-gating, same rationale
    already documented above for weather alerts."""
    feed = home_front.fetch_active_alerts()
    affected = home_front.match_alerts_to_properties(db, feed["alerts"])
    return {**feed, "affected_properties": affected}


@router.get("/seismology/recent-earthquakes", response_model=schemas.SeismologyBulletinOut)
def get_recent_earthquakes(
    limit: int = Query(default=20, ge=1, le=50),
    _user: models.User = Depends(require_roles(*_GIS_ROLES)),
):
    """Real Geological Survey of Israel (GSI) public seismology bulletin —
    see app/integrations/seismology.py for the plain-text parsing approach
    and why a changed bulletin layout degrades to status="unavailable"
    instead of raising."""
    return seismology.fetch_recent_earthquakes(limit=limit)


@router.get("/seismology/nearest-properties", response_model=list[schemas.NearestPropertyToEpicenterOut])
def get_nearest_properties_to_epicenter(
    latitude: float = Query(...),
    longitude: float = Query(...),
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_GIS_ROLES)),
):
    """Real haversine distance from an earthquake epicenter (lat/long, e.g.
    taken from one row of /seismology/recent-earthquakes) to every active
    property, nearest-first — see app/integrations/seismology.py."""
    return seismology.nearest_properties_to_epicenter(db, latitude=latitude, longitude=longitude)


@router.get("/environmental/hazmat-sites", response_model=schemas.HazmatSitesOut)
def get_hazmat_sites(
    _user: models.User = Depends(require_roles(*_GIS_ROLES)),
):
    """Real data.gov.il CKAN Action API call for a hazmat/dangerous-materials
    sites dataset — see app/integrations/environmental.py for the
    search-then-query approach (no fixed resource_id is hardcoded) and why
    an unlocatable/unreachable dataset degrades to status="unavailable"
    with an empty site list."""
    return environmental.fetch_hazmat_sites()


@router.get("/environmental/property-hazmat-proximity", response_model=list[schemas.PropertyHazmatProximityOut])
def get_property_hazmat_proximity(
    property_id: list[int] | None = Query(default=None),
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_GIS_ROLES)),
):
    """For each active property (optionally filtered by property_id), finds
    the nearest hazmat site from the live data.gov.il dataset and flags
    whether it's within the hazard radius — see
    app/integrations/environmental.py. Read-only: nothing here writes to
    Asset_Risk_Profiles.near_hazmat_site (see that column's own docstring
    in app/models.py for why — the §13 automation that would set it from
    this output is out of this branch's scope)."""
    stmt = select(models.Property).where(models.Property.is_active == True)  # noqa: E712
    if property_id:
        stmt = stmt.where(models.Property.property_id.in_(property_id))
    properties = db.scalars(stmt.order_by(models.Property.property_id)).all()

    hazmat_feed = environmental.fetch_hazmat_sites()
    sites = hazmat_feed["sites"]

    rows = []
    for prop in properties:
        proximity = environmental.sites_near_property(sites, float(prop.latitude), float(prop.longitude))
        rows.append({
            "property_id": prop.property_id,
            "property_code": prop.property_code,
            "name": prop.name,
            "within_hazard_radius": proximity["within_hazard_radius"],
            "distance_km": proximity["distance_km"],
            "nearest_site": proximity["nearest_site"],
        })
    return rows


@router.get("/gis/reverse-geocode", response_model=schemas.ReverseGeocodeOut)
def get_reverse_geocode(
    latitude: float = Query(...),
    longitude: float = Query(...),
    _user: models.User = Depends(require_roles()),
):
    """Real OSM Nominatim reverse-geocoding call (lat/long -> street
    address) — see app/integrations/gis.py for the rate-limiting/User-Agent
    handling Nominatim's usage policy requires. Open to any authenticated
    role, no key needed, per TODO_SPEC.md §12: serves field workers filing
    an incident report from GPS coordinates."""
    return gis.reverse_geocode(latitude, longitude)
