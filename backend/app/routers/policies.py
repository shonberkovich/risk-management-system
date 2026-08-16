from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db

router = APIRouter(prefix="/api/policies", tags=["policies"])


@router.get("", response_model=list[schemas.PolicyOut])
def list_policies(db: Session = Depends(get_db)):
    return db.scalars(select(models.InsurancePolicy).order_by(models.InsurancePolicy.policy_id)).all()
