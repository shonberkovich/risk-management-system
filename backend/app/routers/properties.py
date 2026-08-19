from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app import models, schemas
from app.database import get_db

router = APIRouter(prefix="/api/properties", tags=["properties"])


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
