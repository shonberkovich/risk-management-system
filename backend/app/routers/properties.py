from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app import models, schemas
from app.database import get_db

router = APIRouter(prefix="/api/properties", tags=["properties"])


@router.get("", response_model=list[schemas.PropertyOut])
def list_properties(db: Session = Depends(get_db)):
    props = db.scalars(
        select(models.Property)
        .options(joinedload(models.Property.risk_profile))
        .where(models.Property.is_active == True)  # noqa: E712
        .order_by(models.Property.property_id)
    ).all()
    return props


@router.get("/{property_id}", response_model=schemas.PropertyOut)
def get_property(property_id: int, db: Session = Depends(get_db)):
    prop = db.scalar(
        select(models.Property)
        .options(joinedload(models.Property.risk_profile))
        .where(models.Property.property_id == property_id)
    )
    if not prop:
        raise HTTPException(404, "Property not found")
    return prop
