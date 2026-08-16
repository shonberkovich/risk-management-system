from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db

router = APIRouter(prefix="/api/claims", tags=["claims"])


@router.get("", response_model=list[schemas.ClaimTrackingRow])
def list_claims(status: str | None = Query(default=None), db: Session = Depends(get_db)):
    stmt = (
        select(models.Claim, models.Incident, models.Property)
        .join(models.Incident, models.Incident.incident_id == models.Claim.incident_id)
        .join(models.Property, models.Property.property_id == models.Incident.property_id)
        .order_by(models.Claim.claim_id.desc())
    )
    if status:
        stmt = stmt.where(models.Claim.claim_status == status)

    rows = db.execute(stmt).all()
    return [
        schemas.ClaimTrackingRow(
            claim_id=claim.claim_id,
            claim_number=claim.claim_number,
            property_name=prop.name,
            incident_date=incident.incident_timestamp,
            hazard_type=incident.hazard_type,
            claimed_amount=float(claim.claimed_amount),
            deductible_applied=float(claim.deductible_applied),
            approved_amount=float(claim.approved_amount),
            claim_status=claim.claim_status,
            expected_payment_date=claim.expected_payment_date,
        )
        for claim, incident, prop in rows
    ]
