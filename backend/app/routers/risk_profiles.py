"""Asset_Risk_Profiles create/update — TODO_SPEC.md §2, "API לסקרי סיכונים". A
property has at most one risk profile (models.Property.risk_profile, uselist=False,
one-to-one), so unlike most CRUD routers here this is create-once / update-in-place,
not a collection: POST fails with 409 if a profile already exists (use PUT to
re-survey), PUT fails with 404 if none exists yet (use POST first). Nested under
/api/properties/{property_id}/risk-profile rather than a flat /api/risk-profiles
collection since every operation is scoped to exactly one property.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import require_roles

router = APIRouter(prefix="/api/properties/{property_id}/risk-profile", tags=["risk-profiles"])

# Same write-role set as routers/properties.py / mitigation.py — risk surveys are
# part of the same asset-management workflow.
_RISK_PROFILE_WRITE_ROLES = ("RISK_MANAGER", "PROPERTY_MANAGER", "ADMIN")


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

    db.commit()
    db.refresh(prop.risk_profile)
    return prop.risk_profile
