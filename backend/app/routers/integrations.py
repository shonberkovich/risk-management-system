from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import require_roles
from app.integrations import erp, gis, weather

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

# Same write-role set as policies/claims: finance-facing data, not a field-worker concern.
_ERP_ROLES = ("RISK_MANAGER", "CFO", "ADMIN")

# Flood-zone/climate layers feed risk assessment, not finance — same role set
# already used for risk-scoring/survey endpoints, not the ERP one above.
_GIS_ROLES = ("RISK_MANAGER", "RISK_OFFICER", "ADMIN")

# Weather alerts are an operational/field-facing warning (a property manager
# or field worker needs to know a storm is coming, not just risk officers) —
# open to any authenticated role, same as incident reporting.


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
