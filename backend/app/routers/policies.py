from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import require_roles

router = APIRouter(prefix="/api/policies", tags=["policies"])

_POLICIES_WRITE_ROLES = ("RISK_MANAGER", "CFO", "ADMIN")

# TODO_SPEC.md §3, "אכיפת RBAC על בקשות ה-GET": policy data (premiums, limits,
# deductibles) is financial disclosure, same category as analytics.py's KPI/cashflow
# endpoints — everyone except FIELD_WORKER, who has no operational need to see it.
_POLICIES_READ_ROLES = ("RISK_MANAGER", "CFO", "PROPERTY_MANAGER", "RISK_OFFICER", "ADJUSTER", "ADMIN")


@router.get("", response_model=list[schemas.PolicyOut])
def list_policies(
    status: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_POLICIES_READ_ROLES)),
):
    stmt = select(models.InsurancePolicy).order_by(models.InsurancePolicy.policy_id)
    if status:
        stmt = stmt.where(models.InsurancePolicy.status == status)
    return db.scalars(stmt).all()


@router.get("/{policy_id}", response_model=schemas.PolicyOut)
def get_policy(
    policy_id: int,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_POLICIES_READ_ROLES)),
):
    policy = db.get(models.InsurancePolicy, policy_id)
    if not policy:
        raise HTTPException(404, "Policy not found")
    return policy


@router.post("", response_model=schemas.PolicyOut, status_code=201)
def create_policy(
    payload: schemas.PolicyCreate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_POLICIES_WRITE_ROLES)),
):
    policy = models.InsurancePolicy(**payload.model_dump())
    db.add(policy)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Policy number already exists")
    db.refresh(policy)
    return policy


@router.put("/{policy_id}", response_model=schemas.PolicyOut)
def update_policy(
    policy_id: int,
    payload: schemas.PolicyUpdate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_POLICIES_WRITE_ROLES)),
):
    policy = db.get(models.InsurancePolicy, policy_id)
    if not policy:
        raise HTTPException(404, "Policy not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(policy, field, value)
    db.commit()
    db.refresh(policy)
    return policy


@router.get("/{policy_id}/assets", response_model=list[schemas.PolicyAssetOut])
def list_policy_assets(
    policy_id: int,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_POLICIES_READ_ROLES)),
):
    policy = db.get(models.InsurancePolicy, policy_id)
    if not policy:
        raise HTTPException(404, "Policy not found")
    rows = db.execute(
        select(models.PolicyAsset, models.Property.name)
        .join(models.Property, models.Property.property_id == models.PolicyAsset.property_id)
        .where(models.PolicyAsset.policy_id == policy_id)
        .order_by(models.Property.name)
    ).all()
    return [
        schemas.PolicyAssetOut(
            policy_id=asset.policy_id,
            property_id=asset.property_id,
            property_name=property_name,
            specific_deductible=asset.specific_deductible,
        )
        for asset, property_name in rows
    ]


@router.post("/{policy_id}/assets", response_model=schemas.PolicyAssetOut, status_code=201)
def assign_policy_asset(
    policy_id: int,
    payload: schemas.PolicyAssetCreate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_POLICIES_WRITE_ROLES)),
):
    policy = db.get(models.InsurancePolicy, policy_id)
    if not policy:
        raise HTTPException(404, "Policy not found")
    prop = db.get(models.Property, payload.property_id)
    if not prop:
        raise HTTPException(404, "Property not found")
    existing = db.get(models.PolicyAsset, {"policy_id": policy_id, "property_id": payload.property_id})
    if existing:
        raise HTTPException(400, "Property is already assigned to this policy")

    asset = models.PolicyAsset(
        policy_id=policy_id,
        property_id=payload.property_id,
        specific_deductible=payload.specific_deductible,
    )
    db.add(asset)
    db.commit()
    return schemas.PolicyAssetOut(
        policy_id=policy_id,
        property_id=prop.property_id,
        property_name=prop.name,
        specific_deductible=asset.specific_deductible,
    )


@router.delete("/{policy_id}/assets/{property_id}", status_code=204)
def unassign_policy_asset(
    policy_id: int,
    property_id: int,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_POLICIES_WRITE_ROLES)),
):
    asset = db.get(models.PolicyAsset, {"policy_id": policy_id, "property_id": property_id})
    if not asset:
        raise HTTPException(404, "Assignment not found")
    db.delete(asset)
    db.commit()
