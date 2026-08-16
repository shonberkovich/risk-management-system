from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db

router = APIRouter(prefix="/api/incidents", tags=["incidents"])

_STATUS_ORDER = ["NEW", "UNDER_INVESTIGATION", "CLAIM_FILED", "CLOSED"]


def _next_incident_code(db: Session) -> str:
    year = date.today().year
    prefix = f"INC-{year}-"
    count = db.scalar(
        select(func.count()).select_from(models.Incident)
        .where(models.Incident.incident_code.like(f"{prefix}%"))
    ) or 0
    return f"{prefix}{count + 1:03d}"


@router.get("", response_model=list[schemas.IncidentOut])
def list_incidents(
    status: str | None = Query(default=None),
    property_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    stmt = select(models.Incident).order_by(models.Incident.incident_timestamp.desc())
    if status:
        stmt = stmt.where(models.Incident.status == status)
    if property_id:
        stmt = stmt.where(models.Incident.property_id == property_id)
    return db.scalars(stmt).all()


@router.get("/{incident_id}", response_model=schemas.IncidentOut)
def get_incident(incident_id: int, db: Session = Depends(get_db)):
    incident = db.get(models.Incident, incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")
    return incident


@router.post("", response_model=schemas.IncidentOut, status_code=201)
def create_incident(payload: schemas.IncidentCreate, db: Session = Depends(get_db)):
    prop = db.get(models.Property, payload.property_id)
    if not prop:
        raise HTTPException(404, "Property not found")

    incident = models.Incident(
        incident_code=_next_incident_code(db),
        property_id=payload.property_id,
        reported_by_user_id=payload.reported_by_user_id,
        incident_timestamp=payload.incident_timestamp,
        hazard_type=payload.hazard_type,
        severity_level=payload.severity_level,
        operational_impact=payload.operational_impact,
        initial_estimated_loss=payload.initial_estimated_loss,
        description=payload.description,
        status="NEW",
        ai_classified=payload.ai_classified,
        ai_confidence=payload.ai_confidence,
        created_at=datetime.now(),
    )
    db.add(incident)
    db.commit()
    db.refresh(incident)
    return incident


@router.patch("/{incident_id}/status", response_model=schemas.IncidentOut)
def update_incident_status(incident_id: int, payload: schemas.IncidentStatusUpdate, db: Session = Depends(get_db)):
    incident = db.get(models.Incident, incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")

    if payload.status == "CLAIM_FILED":
        raise HTTPException(400, "סטטוס 'תביעה הוגשה' נקבע אוטומטית בעת פתיחת תביעה, לא ידנית")
    if incident.status == "CLOSED":
        raise HTTPException(400, "לא ניתן לשנות סטטוס של אירוע סגור")
    if _STATUS_ORDER.index(payload.status) < _STATUS_ORDER.index(incident.status):
        raise HTTPException(400, "לא ניתן להחזיר סטטוס אירוע לאחור")

    incident.status = payload.status
    db.commit()
    db.refresh(incident)
    return incident


@router.get("/{incident_id}/eligible-policies", response_model=list[schemas.PolicyOut])
def list_eligible_policies(incident_id: int, db: Session = Depends(get_db)):
    incident = db.get(models.Incident, incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")

    stmt = (
        select(models.InsurancePolicy)
        .join(models.PolicyAsset, models.PolicyAsset.policy_id == models.InsurancePolicy.policy_id)
        .where(models.PolicyAsset.property_id == incident.property_id)
        .where(models.InsurancePolicy.status == "ACTIVE")
    )
    return db.scalars(stmt).all()
