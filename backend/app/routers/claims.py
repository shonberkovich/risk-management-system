from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db

router = APIRouter(prefix="/api/claims", tags=["claims"])

_TERMINAL_CLAIM_STATUSES = {"SETTLED", "REJECTED"}


def _next_claim_number(db: Session) -> str:
    year = date.today().year
    prefix = f"CLM-{year}-"
    count = db.scalar(
        select(func.count()).select_from(models.Claim)
        .where(models.Claim.claim_number.like(f"{prefix}%"))
    ) or 0
    return f"{prefix}{count + 1:03d}"


_PAYABLE_CLAIM_STATUSES = {"APPROVED", "SETTLED"}


@router.get("", response_model=list[schemas.ClaimTrackingRow])
def list_claims(status: str | None = Query(default=None), db: Session = Depends(get_db)):
    paid_subq = (
        select(
            models.ClaimPayment.claim_id.label("claim_id"),
            func.sum(models.ClaimPayment.amount).label("paid_amount"),
        )
        .group_by(models.ClaimPayment.claim_id)
        .subquery()
    )
    stmt = (
        select(models.Claim, models.Incident, models.Property, paid_subq.c.paid_amount)
        .join(models.Incident, models.Incident.incident_id == models.Claim.incident_id)
        .join(models.Property, models.Property.property_id == models.Incident.property_id)
        .outerjoin(paid_subq, paid_subq.c.claim_id == models.Claim.claim_id)
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
            paid_amount=float(paid_amount or 0),
        )
        for claim, incident, prop, paid_amount in rows
    ]


@router.get("/{claim_id}", response_model=schemas.ClaimOut)
def get_claim(claim_id: int, db: Session = Depends(get_db)):
    claim = db.get(models.Claim, claim_id)
    if not claim:
        raise HTTPException(404, "Claim not found")
    return claim


@router.post("", response_model=schemas.ClaimOut, status_code=201)
def create_claim(payload: schemas.ClaimCreate, db: Session = Depends(get_db)):
    incident = db.get(models.Incident, payload.incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")
    if incident.status == "CLOSED":
        raise HTTPException(400, "לא ניתן לפתוח תביעה עבור אירוע סגור")

    policy = db.get(models.InsurancePolicy, payload.policy_id)
    if not policy:
        raise HTTPException(404, "Policy not found")

    claim = models.Claim(
        claim_number=_next_claim_number(db),
        incident_id=payload.incident_id,
        policy_id=payload.policy_id,
        claimed_amount=payload.claimed_amount,
        deductible_applied=payload.deductible_applied,
        approved_amount=0,
        claim_status="DRAFT",
        adjuster_name=payload.adjuster_name,
        expected_payment_date=payload.expected_payment_date,
        created_at=datetime.now(),
    )
    db.add(claim)
    incident.status = "CLAIM_FILED"
    db.commit()
    db.refresh(claim)
    return claim


@router.patch("/{claim_id}", response_model=schemas.ClaimOut)
def update_claim(claim_id: int, payload: schemas.ClaimUpdate, db: Session = Depends(get_db)):
    claim = db.get(models.Claim, claim_id)
    if not claim:
        raise HTTPException(404, "Claim not found")
    if claim.claim_status in _TERMINAL_CLAIM_STATUSES:
        raise HTTPException(400, "לא ניתן לעדכן תביעה שכבר נסגרה או נדחתה")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(claim, field, value)

    if claim.claim_status in _TERMINAL_CLAIM_STATUSES:
        incident = db.get(models.Incident, claim.incident_id)
        sibling_claims = db.scalars(
            select(models.Claim).where(models.Claim.incident_id == claim.incident_id)
        ).all()
        if incident and all(c.claim_status in _TERMINAL_CLAIM_STATUSES for c in sibling_claims):
            incident.status = "CLOSED"

    db.commit()
    db.refresh(claim)
    return claim


@router.get("/{claim_id}/payments", response_model=list[schemas.ClaimPaymentOut])
def list_claim_payments(claim_id: int, db: Session = Depends(get_db)):
    claim = db.get(models.Claim, claim_id)
    if not claim:
        raise HTTPException(404, "Claim not found")
    return db.scalars(
        select(models.ClaimPayment)
        .where(models.ClaimPayment.claim_id == claim_id)
        .order_by(models.ClaimPayment.payment_date)
    ).all()


@router.post("/{claim_id}/payments", response_model=schemas.ClaimPaymentOut, status_code=201)
def create_claim_payment(claim_id: int, payload: schemas.ClaimPaymentCreate, db: Session = Depends(get_db)):
    claim = db.get(models.Claim, claim_id)
    if not claim:
        raise HTTPException(404, "Claim not found")
    if claim.claim_status not in _PAYABLE_CLAIM_STATUSES:
        raise HTTPException(400, "ניתן לרשום תשלום רק לתביעה מאושרת או סגורה")

    paid_so_far = db.scalar(
        select(func.sum(models.ClaimPayment.amount)).where(models.ClaimPayment.claim_id == claim_id)
    ) or 0
    if float(paid_so_far) + payload.amount > float(claim.approved_amount) + 0.01:
        raise HTTPException(400, "סכום התשלום חורג מהסכום המאושר לתביעה")

    payment = models.ClaimPayment(
        claim_id=claim_id,
        payment_date=payload.payment_date,
        amount=payload.amount,
        reference_number=payload.reference_number,
        payment_type=payload.payment_type,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment
