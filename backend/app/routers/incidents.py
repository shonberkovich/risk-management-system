from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app import models, schemas
from app.config import settings
from app.database import get_db
from app.dependencies.permissions import require_roles
from app.integrations import erp
from app.services import notifications

router = APIRouter(prefix="/api/incidents", tags=["incidents"])

_STATUS_WRITE_ROLES = ("RISK_MANAGER", "PROPERTY_MANAGER", "RISK_OFFICER", "ADMIN")

_STATUS_ORDER = ["NEW", "UNDER_INVESTIGATION", "CLAIM_FILED", "CLOSED"]

# Days a CRITICAL-incident follow-up task gets before it's OVERDUE — short on
# purpose, this is the "someone must look at this now" branch, not routine
# mitigation planning.
_CRITICAL_TICKET_TASK_DUE_DAYS = 3


def _trigger_critical_incident_ticket(db: Session, incident: models.Incident) -> None:
    """Fires the "auto-ticket + auto-alert on critical incident" side effects
    (TODO_SPEC.md §2, "אוטומציית שטח (ERP & Alerts)"): a real Mitigation_Tasks row
    (so it shows up on the mitigation board like any other task), a simulated
    ERP/maintenance ticket (app/integrations/erp.py:open_maintenance_ticket), and a
    simulated Push/SMS/Email alert to the active Notification_Recipients
    (services/notifications.dispatch_critical_incident_alert). No-op below CRITICAL
    severity, or if notifications are disabled (settings.notifications_enabled) —
    same graceful-degradation convention as routers/notifications.py, but this is a
    background trigger, not a caller-facing endpoint, so it's a silent skip rather
    than a 503. Caller is responsible for the incident already being committed/
    flushed (has an incident_id) before calling this."""
    if incident.severity_level != "CRITICAL":
        return

    task = models.MitigationTask(
        property_id=incident.property_id,
        title=f"טיפול דחוף באירוע קריטי {incident.incident_code} ({incident.hazard_type})",
        cost_estimate=0,
        expected_annual_savings=0,
        due_date=date.today() + timedelta(days=_CRITICAL_TICKET_TASK_DUE_DAYS),
        status="OPEN",
        assigned_to_user_id=None,
        created_at=datetime.now(),
    )
    db.add(task)
    db.commit()

    erp.open_maintenance_ticket(incident)

    if settings.notifications_enabled:
        notifications.dispatch_critical_incident_alert(db, incident)


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


@router.get("/{incident_id}/full", response_model=schemas.IncidentDrillDown)
def get_incident_drilldown(incident_id: int, db: Session = Depends(get_db)):
    """Unified incident file (Drill-down): the incident + its media + its claim(s),
    each claim with its payments + any documents attached directly to the incident
    (Documents.entity_type == "INCIDENT"), all in a single call for the incident
    detail screen — avoids the frontend firing five separate requests."""
    incident = db.get(models.Incident, incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")

    media = db.scalars(
        select(models.IncidentMedia)
        .where(models.IncidentMedia.incident_id == incident_id)
        .order_by(models.IncidentMedia.captured_at.desc())
    ).all()

    claims = db.scalars(
        select(models.Claim)
        .where(models.Claim.incident_id == incident_id)
        .options(selectinload(models.Claim.payments))
        .order_by(models.Claim.created_at.desc())
    ).all()

    documents = db.scalars(
        select(models.Document)
        .where(models.Document.entity_type == "INCIDENT", models.Document.entity_id == incident_id)
        .order_by(models.Document.uploaded_at.desc())
    ).all()

    return {
        "incident": incident,
        "media": media,
        "claims": claims,
        "documents": documents,
    }


@router.post("", response_model=schemas.IncidentOut, status_code=201)
def create_incident(
    payload: schemas.IncidentCreate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles()),  # any authenticated role — field workers report incidents
):
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
        is_draft=payload.is_draft,
        business_interruption_requested=payload.business_interruption_requested,
        area_or_building=payload.area_or_building,
        reported_coordinates=payload.reported_coordinates,
    )
    db.add(incident)
    db.commit()
    db.refresh(incident)

    if not incident.is_draft:
        _trigger_critical_incident_ticket(db, incident)

    return incident


@router.patch("/{incident_id}", response_model=schemas.IncidentOut)
def update_draft_incident(
    incident_id: int,
    payload: schemas.IncidentUpdate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles()),
):
    """Edits a draft's fields before it's submitted. Once an incident has been
    submitted (is_draft=False) its report content is frozen here — status still
    progresses via PATCH /{incident_id}/status as usual."""
    incident = db.get(models.Incident, incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")
    if not incident.is_draft:
        raise HTTPException(400, "לא ניתן לערוך אירוע שכבר הוגש — רק טיוטות ניתנות לעריכה")

    if payload.property_id is not None and db.get(models.Property, payload.property_id) is None:
        raise HTTPException(404, "Property not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(incident, field, value)

    db.commit()
    db.refresh(incident)
    return incident


@router.patch("/{incident_id}/submit", response_model=schemas.IncidentOut)
def submit_draft_incident(
    incident_id: int,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles()),
):
    """Draft → Submitted: flips is_draft off. Idempotent-unsafe by design — a
    second call on an already-submitted incident is rejected, mirroring the
    guard on PATCH /{incident_id}/status not allowing status to move backwards."""
    incident = db.get(models.Incident, incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")
    if not incident.is_draft:
        raise HTTPException(400, "האירוע כבר הוגש")

    incident.is_draft = False
    db.commit()
    db.refresh(incident)

    _trigger_critical_incident_ticket(db, incident)

    return incident


@router.patch("/{incident_id}/status", response_model=schemas.IncidentOut)
def update_incident_status(
    incident_id: int,
    payload: schemas.IncidentStatusUpdate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_STATUS_WRITE_ROLES)),
):
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
