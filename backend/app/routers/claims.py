import threading
import time
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import require_roles

router = APIRouter(prefix="/api/claims", tags=["claims"])

_CLAIMS_WRITE_ROLES = ("RISK_MANAGER", "CFO", "ADJUSTER", "ADMIN")

_TERMINAL_CLAIM_STATUSES = {"SETTLED", "REJECTED"}

# --- Idempotent/duplicate-safe creation (TODO_SPEC.md §2, "Race Conditions
# ביצירת אירועים/תביעות") --------------------------------------------------
#
# Same pattern as routers/incidents.py's create_incident: an Idempotency-Key
# header, if sent, short-circuits a repeat request with the same key to the
# claim created by the first; if no header is sent, a narrow natural-key
# duplicate check (same incident + same policy + same claimed amount,
# created within the last few seconds) catches an accidental double
# double-click/retry instead. Both paths run under _CREATE_LOCK so there's
# no TOCTOU window between the duplicate check and the insert. In-process
# only (module-level dict + threading.Lock) — correct for this course
# project's single-worker uvicorn deployment.
_CREATE_LOCK = threading.Lock()
_IDEMPOTENCY_CACHE: dict[str, tuple[float, "models.Claim"]] = {}
_IDEMPOTENCY_TTL_SECONDS = 120
_DUPLICATE_WINDOW_SECONDS = 5


def _purge_idempotency_cache_locked() -> None:
    """Caller must hold _CREATE_LOCK."""
    cutoff = time.monotonic() - _IDEMPOTENCY_TTL_SECONDS
    for stale_key in [k for k, (ts, _) in _IDEMPOTENCY_CACHE.items() if ts < cutoff]:
        del _IDEMPOTENCY_CACHE[stale_key]


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
def create_claim(
    payload: schemas.ClaimCreate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_CLAIMS_WRITE_ROLES)),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    """Race-condition-safe against two near-simultaneous duplicate submissions
    (double-click, retried request) — see the idempotency/duplicate-check
    helpers above the router. The whole check-then-insert critical section
    runs under _CREATE_LOCK so there's no window for two concurrent requests
    to both pass the duplicate check before either has committed."""
    with _CREATE_LOCK:
        if idempotency_key:
            _purge_idempotency_cache_locked()
            cached = _IDEMPOTENCY_CACHE.get(idempotency_key)
            if cached:
                return cached[1]

        incident = db.get(models.Incident, payload.incident_id)
        if not incident:
            raise HTTPException(404, "Incident not found")
        if incident.status == "CLOSED":
            raise HTTPException(400, "לא ניתן לפתוח תביעה עבור אירוע סגור")

        policy = db.get(models.InsurancePolicy, payload.policy_id)
        if not policy:
            raise HTTPException(404, "Policy not found")

        if not idempotency_key:
            duplicate_cutoff = datetime.now() - timedelta(seconds=_DUPLICATE_WINDOW_SECONDS)
            duplicate = db.scalar(
                select(models.Claim)
                .where(models.Claim.incident_id == payload.incident_id)
                .where(models.Claim.policy_id == payload.policy_id)
                .where(models.Claim.claimed_amount == payload.claimed_amount)
                .where(models.Claim.created_at >= duplicate_cutoff)
                .order_by(models.Claim.created_at.desc())
            )
            if duplicate:
                return duplicate

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

        if idempotency_key:
            _IDEMPOTENCY_CACHE[idempotency_key] = (time.monotonic(), claim)

        return claim


@router.patch("/{claim_id}", response_model=schemas.ClaimOut)
def update_claim(
    claim_id: int,
    payload: schemas.ClaimUpdate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_CLAIMS_WRITE_ROLES)),
):
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
def create_claim_payment(
    claim_id: int,
    payload: schemas.ClaimPaymentCreate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_CLAIMS_WRITE_ROLES)),
):
    claim = db.get(models.Claim, claim_id)
    if not claim:
        raise HTTPException(404, "Claim not found")
    if claim.claim_status not in _PAYABLE_CLAIM_STATUSES:
        raise HTTPException(400, "ניתן לרשום תשלום רק לתביעה מאושרת או סגורה")
    # ClaimPaymentCreate.amount has no ge=0 constraint at the schema level (unlike
    # ClaimCreate.claimed_amount/ClaimReserveCreate.reserve_amount, which do) — a
    # zero/negative amount here would silently corrupt the running "paid so far" total
    # and could be used to bypass the exceeds-approved-amount guard below (submit a
    # negative payment first to create headroom, then overpay). Enforce it here instead
    # of loosening this check.
    if payload.amount <= 0:
        raise HTTPException(400, "סכום התשלום חייב להיות חיובי")

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


@router.get("/{claim_id}/reserves", response_model=list[schemas.ClaimReserveOut])
def list_claim_reserves(claim_id: int, db: Session = Depends(get_db)):
    claim = db.get(models.Claim, claim_id)
    if not claim:
        raise HTTPException(404, "Claim not found")
    return db.scalars(
        select(models.ClaimReserve)
        .where(models.ClaimReserve.claim_id == claim_id)
        .order_by(models.ClaimReserve.updated_at.desc())
    ).all()


@router.post("/{claim_id}/reserves", response_model=schemas.ClaimReserveOut, status_code=201)
def create_claim_reserve(
    claim_id: int,
    payload: schemas.ClaimReserveCreate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_CLAIMS_WRITE_ROLES)),
):
    """Records the expected outstanding liability (reserve) for an open claim — see
    services/cashflow.get_current_reserves, which reads the most recent Claim_Reserves
    row per claim for cash-flow projections. Only meaningful while the claim is still
    open (not yet SETTLED/REJECTED), same terminal-status guard as update_claim."""
    claim = db.get(models.Claim, claim_id)
    if not claim:
        raise HTTPException(404, "Claim not found")
    if claim.claim_status in _TERMINAL_CLAIM_STATUSES:
        raise HTTPException(400, "לא ניתן להזין רזרבה לתביעה שכבר נסגרה או נדחתה")

    reserve = models.ClaimReserve(
        claim_id=claim_id,
        reserve_amount=payload.reserve_amount,
        expected_payment_date=payload.expected_payment_date,
        updated_at=datetime.now(),
    )
    db.add(reserve)
    db.commit()
    db.refresh(reserve)
    return reserve


@router.patch("/{claim_id}/reserves/{reserve_id}", response_model=schemas.ClaimReserveOut)
def update_claim_reserve(
    claim_id: int,
    reserve_id: int,
    payload: schemas.ClaimReserveUpdate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_CLAIMS_WRITE_ROLES)),
):
    claim = db.get(models.Claim, claim_id)
    if not claim:
        raise HTTPException(404, "Claim not found")
    reserve = db.get(models.ClaimReserve, reserve_id)
    if not reserve or reserve.claim_id != claim_id:
        raise HTTPException(404, "Claim reserve not found")
    if claim.claim_status in _TERMINAL_CLAIM_STATUSES:
        raise HTTPException(400, "לא ניתן לעדכן רזרבה לתביעה שכבר נסגרה או נדחתה")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(reserve, field, value)
    reserve.updated_at = datetime.now()

    db.commit()
    db.refresh(reserve)
    return reserve
