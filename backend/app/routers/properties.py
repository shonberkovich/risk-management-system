from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import require_roles

router = APIRouter(prefix="/api/properties", tags=["properties"])

# Same write-role set as routers/mitigation.py (_MITIGATION_WRITE_ROLES) — property
# inventory is managed by the same risk/property-manager roles that manage the
# mitigation tasks hanging off it, plus ADMIN.
_PROPERTIES_WRITE_ROLES = ("RISK_MANAGER", "PROPERTY_MANAGER", "ADMIN")


def _to_property_out(prop: models.Property) -> schemas.PropertyOut:
    # "Active policy" for a property = the policy covering it (via Policy_Assets)
    # whose status is ACTIVE. A property could theoretically have more than one
    # (renewal overlap); we surface the one with the furthest end_date as "the"
    # active policy for display purposes.
    active_assets = [pa for pa in prop.policy_assets if pa.policy.status == "ACTIVE"]
    active_asset = max(active_assets, key=lambda pa: pa.policy.end_date, default=None)
    active_policy = (
        schemas.PropertyActivePolicyOut(
            policy_id=active_asset.policy.policy_id,
            policy_number=active_asset.policy.policy_number,
            insurer_name=active_asset.policy.insurer_name,
            total_limit=active_asset.policy.total_limit,
            per_event_limit=active_asset.policy.per_event_limit,
            specific_deductible=active_asset.specific_deductible,
        )
        if active_asset
        else None
    )
    out = schemas.PropertyOut.model_validate(prop)
    out.manager_name = prop.primary_manager.full_name if prop.primary_manager else None
    out.active_policy = active_policy
    return out


@router.get("", response_model=list[schemas.PropertyOut])
def list_properties(db: Session = Depends(get_db)):
    props = db.scalars(
        select(models.Property)
        .options(
            joinedload(models.Property.risk_profile),
            joinedload(models.Property.primary_manager),
            joinedload(models.Property.policy_assets).joinedload(models.PolicyAsset.policy),
        )
        .where(models.Property.is_active == True)  # noqa: E712
        .order_by(models.Property.property_id)
    ).unique().all()
    return [_to_property_out(p) for p in props]


@router.get("/{property_id}", response_model=schemas.PropertyOut)
def get_property(property_id: int, db: Session = Depends(get_db)):
    prop = db.scalar(
        select(models.Property)
        .options(
            joinedload(models.Property.risk_profile),
            joinedload(models.Property.primary_manager),
            joinedload(models.Property.policy_assets).joinedload(models.PolicyAsset.policy),
        )
        .where(models.Property.property_id == property_id)
    )
    if not prop:
        raise HTTPException(404, "Property not found")
    return _to_property_out(prop)


def _load_with_relations(db: Session, property_id: int) -> models.Property | None:
    """Same eager-load shape as list/get above, reused after create/update so the
    response includes manager_name/active_policy without a second round trip surprise."""
    return db.scalar(
        select(models.Property)
        .options(
            joinedload(models.Property.risk_profile),
            joinedload(models.Property.primary_manager),
            joinedload(models.Property.policy_assets).joinedload(models.PolicyAsset.policy),
        )
        .where(models.Property.property_id == property_id)
    )


@router.post("", response_model=schemas.PropertyOut, status_code=201)
def create_property(
    payload: schemas.PropertyCreate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_PROPERTIES_WRITE_ROLES)),
):
    if payload.primary_manager_id is not None and not db.get(models.User, payload.primary_manager_id):
        raise HTTPException(404, "Manager (user) not found")
    if payload.region_id is not None and not db.get(models.Region, payload.region_id):
        raise HTTPException(404, "Region not found")

    now = datetime.now()
    prop = models.Property(
        **payload.model_dump(),
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    db.add(prop)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Property code already exists")
    db.refresh(prop)
    return _to_property_out(_load_with_relations(db, prop.property_id))


@router.put("/{property_id}", response_model=schemas.PropertyOut)
def update_property(
    property_id: int,
    payload: schemas.PropertyUpdate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_PROPERTIES_WRITE_ROLES)),
):
    prop = db.get(models.Property, property_id)
    if not prop:
        raise HTTPException(404, "Property not found")

    updates = payload.model_dump(exclude_unset=True)
    if "primary_manager_id" in updates and updates["primary_manager_id"] is not None:
        if not db.get(models.User, updates["primary_manager_id"]):
            raise HTTPException(404, "Manager (user) not found")
    if "region_id" in updates and updates["region_id"] is not None:
        if not db.get(models.Region, updates["region_id"]):
            raise HTTPException(404, "Region not found")

    for field, value in updates.items():
        setattr(prop, field, value)
    prop.updated_at = datetime.now()

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Property code already exists")
    db.refresh(prop)
    return _to_property_out(_load_with_relations(db, prop.property_id))


@router.delete("/{property_id}", status_code=204)
def delete_property(
    property_id: int,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_PROPERTIES_WRITE_ROLES)),
):
    """Soft delete: sets is_active=False rather than removing the row. Properties are
    the root of the value chain this whole schema is organized around (Properties →
    Asset_Risk_Profiles → Incidents → Claims → Claim_Payments, see CLAUDE.md) — a hard
    delete would either violate FK constraints on a real DB (dependent risk profile /
    incidents / mitigation tasks / policy links) or silently orphan that history.
    list_properties already filters on is_active, so a soft-deleted property simply
    stops appearing there and in the map/KPI aggregates that reuse that query, while
    its history stays intact and reachable via GET /{property_id}."""
    prop = db.get(models.Property, property_id)
    if not prop:
        raise HTTPException(404, "Property not found")
    prop.is_active = False
    prop.updated_at = datetime.now()
    db.commit()
