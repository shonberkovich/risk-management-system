"""Asset_Risk_Profiles create/update — TODO_SPEC.md §2, "API לסקרי סיכונים". A
property has at most one risk profile (models.Property.risk_profile, uselist=False,
one-to-one), so unlike most CRUD routers here this is create-once / update-in-place,
not a collection: POST fails with 409 if a profile already exists (use PUT to
re-survey), PUT fails with 404 if none exists yet (use POST first). Nested under
/api/properties/{property_id}/risk-profile rather than a flat /api/risk-profiles
collection since every operation is scoped to exactly one property.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import require_roles
from app.integrations import environmental
from app.integrations._http import IntegrationFetchError

router = APIRouter(prefix="/api/properties/{property_id}/risk-profile", tags=["risk-profiles"])

logger = logging.getLogger("rmis.routers.risk_profiles")

# Same write-role set as routers/properties.py / mitigation.py — risk surveys are
# part of the same asset-management workflow.
_RISK_PROFILE_WRITE_ROLES = ("RISK_MANAGER", "PROPERTY_MANAGER", "ADMIN")

# TODO_SPEC.md §13 item 2 ("שערוך ציון אש לפי חומרים מסוכנים") — automatic
# fire_risk_score penalty applied when a property is found near a hazmat site.
# fire_risk_score is Pydantic-validated to the 1-5 range (schemas.RiskProfileCreate/
# Update, Field(ge=1, le=5)); the penalty is clamped to that same range below so it
# can never push a profile out of the range the API otherwise enforces.
_HAZMAT_FIRE_RISK_PENALTY = 1
_FIRE_RISK_SCORE_MAX = 5
_FIRE_RISK_SCORE_MIN = 1


def _apply_hazmat_penalty(profile: models.AssetRiskProfile, prop: models.Property) -> None:
    """Best-effort hazmat-proximity check (TODO_SPEC.md §13 item 2): calls the
    data.gov.il hazmat connector (app/integrations/environmental.py) for the
    property's coordinates and, if a hazmat site is found within its hazard
    radius, sets `near_hazmat_site=True` and applies a one-time penalty to
    `fire_risk_score` (clamped to the field's existing 1-5 valid range).

    Degrades gracefully per CLAUDE.md's "AI features degrade gracefully"
    convention (same idea applied to this external connector instead of an AI
    call): if the environmental integration is unreachable/degraded
    (`status != "ok"`) or raises `IntegrationFetchError`, this logs a warning
    and leaves the profile's hazmat fields exactly as the caller already set
    them from the request payload — it never fails the surrounding create/
    update request."""
    try:
        result = environmental.fetch_hazmat_sites()
        if result["status"] != "ok":
            logger.warning(
                "[HAZMAT PENALTY] environmental.fetch_hazmat_sites unavailable for property %s — skipping penalty",
                prop.property_id,
            )
            return

        # environmental.sites_near_property does raw float arithmetic — Property.latitude/
        # longitude come back as Decimal on some dialects, same reason
        # seismology.nearest_properties_to_epicenter casts with float(...) too.
        proximity = environmental.sites_near_property(result["sites"], float(prop.latitude), float(prop.longitude))
    except IntegrationFetchError as exc:
        logger.warning(
            "[HAZMAT PENALTY] hazmat lookup failed for property %s: %s — skipping penalty", prop.property_id, exc
        )
        return

    if not proximity["within_hazard_radius"]:
        return

    # Idempotency guard: only apply the score penalty the first time proximity is
    # detected for this profile. Without this, an unrelated PUT (e.g. just editing
    # `notes`) on a profile that's already flagged would silently re-apply the
    # penalty and keep pushing fire_risk_score up on every single update call.
    already_flagged = profile.near_hazmat_site
    profile.near_hazmat_site = True
    if not already_flagged:
        profile.fire_risk_score = min(
            _FIRE_RISK_SCORE_MAX, max(_FIRE_RISK_SCORE_MIN, profile.fire_risk_score + _HAZMAT_FIRE_RISK_PENALTY)
        )


def _get_property_or_404(db: Session, property_id: int) -> models.Property:
    prop = db.get(models.Property, property_id)
    if not prop:
        raise HTTPException(404, "Property not found")
    return prop


@router.get("", response_model=schemas.RiskProfileOut)
def get_risk_profile(property_id: int, db: Session = Depends(get_db)):
    prop = _get_property_or_404(db, property_id)
    if not prop.risk_profile:
        raise HTTPException(404, "Property has no risk profile yet")
    return prop.risk_profile


@router.post("", response_model=schemas.RiskProfileOut, status_code=201)
def create_risk_profile(
    property_id: int,
    payload: schemas.RiskProfileCreate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_RISK_PROFILE_WRITE_ROLES)),
):
    prop = _get_property_or_404(db, property_id)
    if prop.risk_profile:
        raise HTTPException(409, "Property already has a risk profile — use PUT to update it")

    profile = models.AssetRiskProfile(property_id=property_id, **payload.model_dump())
    _apply_hazmat_penalty(profile, prop)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


@router.put("", response_model=schemas.RiskProfileOut)
def update_risk_profile(
    property_id: int,
    payload: schemas.RiskProfileUpdate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_RISK_PROFILE_WRITE_ROLES)),
):
    prop = _get_property_or_404(db, property_id)
    if not prop.risk_profile:
        raise HTTPException(404, "Property has no risk profile yet — use POST to create one")

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(prop.risk_profile, field, value)

    _apply_hazmat_penalty(prop.risk_profile, prop)

    db.commit()
    db.refresh(prop.risk_profile)
    return prop.risk_profile
