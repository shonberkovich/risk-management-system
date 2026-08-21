import threading
import time
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app import models, schemas
from app.config import settings
from app.database import get_db
from app.dependencies.permissions import require_roles
from app.integrations import erp, gis, seismology
from app.services import notifications

router = APIRouter(prefix="/api/incidents", tags=["incidents"])

# --- Idempotent/duplicate-safe creation (TODO_SPEC.md §2, "Race Conditions
# ביצירת אירועים/תביעות") --------------------------------------------------
#
# Two mechanisms, both guarded by the same process-wide lock so there's no
# TOCTOU window between a duplicate check and the insert:
#
# 1. Idempotency-Key header: if the client sends one (a double-click handler
#    or a retried request would reuse the same key), a second request with
#    the same key short-circuits to the record created by the first instead
#    of inserting again. Entries expire after _IDEMPOTENCY_TTL_SECONDS so the
#    in-process cache doesn't grow unbounded on a long-running server.
# 2. No header sent: fall back to a narrow natural-key duplicate check —
#    same property + hazard type + reporter, created within the last few
#    seconds — and return the existing row instead of inserting a near-
#    identical duplicate.
#
# This is an in-process cache/lock (module-level dict + threading.Lock), not
# a distributed one — correct for this course project's single-worker
# uvicorn deployment, not intended to survive a multi-process/multi-instance
# setup without a shared store instead.
_CREATE_LOCK = threading.Lock()
_IDEMPOTENCY_CACHE: dict[str, tuple[float, "models.Incident"]] = {}
_IDEMPOTENCY_TTL_SECONDS = 120
_DUPLICATE_WINDOW_SECONDS = 5


def _purge_idempotency_cache_locked() -> None:
    """Caller must hold _CREATE_LOCK."""
    cutoff = time.monotonic() - _IDEMPOTENCY_TTL_SECONDS
    for stale_key in [k for k, (ts, _) in _IDEMPOTENCY_CACHE.items() if ts < cutoff]:
        del _IDEMPOTENCY_CACHE[stale_key]

_STATUS_WRITE_ROLES = ("RISK_MANAGER", "PROPERTY_MANAGER", "RISK_OFFICER", "ADMIN")

_STATUS_ORDER = ["NEW", "UNDER_INVESTIGATION", "CLAIM_FILED", "CLOSED"]

# TODO_SPEC.md §13 item 1 ("אוטומציה: פתיחת טיוטת אירוע בעקבות רעידת אדמה") —
# role-gated to the same "can act on incidents on behalf of the org" set as the
# manual-trigger endpoint below, per the spec's explicit role note.
_SEISMIC_TRIGGER_ROLES = ("RISK_MANAGER", "ADMIN")

# GSI's bulletin has no "felt/significant" flag of its own — this is this
# course project's own simple, documented threshold (Richter-scale magnitude)
# for "worth auto-drafting an incident for nearby properties", not a real
# seismological intensity/felt-shaking model.
_SIGNIFICANT_MAGNITUDE = 3.0

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


def check_seismic_activity(db: Session) -> list[models.Incident]:
    """TODO_SPEC.md §13 item 1 ("אוטומציה: פתיחת טיוטת אירוע בעקבות רעידת אדמה"):
    calls the GSI seismology connector (app/integrations/seismology.py) and, for
    every felt/significant earthquake (magnitude >= _SIGNIFICANT_MAGNITUDE),
    auto-creates a draft (is_draft=True) STRUCTURAL_FAILURE incident — "go
    inspect this property" instruction for a risk manager, not a confirmed
    incident report — for every active property within the felt radius
    (seismology.nearest_properties_to_epicenter's felt_locally flag, itself a
    real haversine distance).

    Background/system-triggered, same pattern as `_trigger_critical_incident_ticket`
    above: a plain callable, not an endpoint body, so it can be invoked from
    anywhere (the manual endpoint below, a future real scheduler, a test).
    System-generated: `reported_by_user_id` is left None — no end user reported
    these, same convention as this table already allows for any other
    system-authored row (the column is nullable specifically for this reason;
    see models.py). Auto-created drafts need no new permission to view — normal
    incident-read RBAC (i.e. none — GET /api/incidents is open) already covers
    them, per the spec's explicit note.

    Scope decision: no real cron/scheduler runs this automatically in this
    course demo (TODO_SPEC.md explicitly says one isn't required) — it's meant
    to be invoked either by a real scheduler in a production deployment, or, for
    this demo, via `POST /api/incidents/check-seismic-activity` below.

    Idempotency: re-invoking this (e.g. the manual endpoint called twice while
    the same earthquake is still in GSI's "recent" bulletin) must not spam a
    fresh draft per call — before creating one, this checks for an existing
    draft STRUCTURAL_FAILURE incident on the same property whose description
    already references that exact event's timestamp, and skips it if found.

    Returns the list of newly-created Incident rows (already committed); does
    NOT reuse `_trigger_critical_incident_ticket` — these drafts are
    deliberately not CRITICAL/submitted, so that side-effect chain (real
    mitigation ticket, ERP ticket, push/SMS/email alert) intentionally does not
    fire until/unless a risk manager reviews and submits the draft."""
    feed = seismology.fetch_recent_earthquakes()
    if feed["status"] != "ok":
        return []

    created: list[models.Incident] = []
    for event in feed["events"]:
        if event["magnitude"] < _SIGNIFICANT_MAGNITUDE:
            continue

        nearby = seismology.nearest_properties_to_epicenter(db, event["latitude"], event["longitude"])
        for row in nearby:
            if not row["felt_locally"]:
                continue

            description = (
                f"טיוטת אירוע אוטומטית: רעידת אדמה בעוצמה {event['magnitude']} זוהתה על ידי המכון "
                f"הגיאולוגי ב-{event['event_time']} ({event.get('region') or 'ללא ציון אזור'}), "
                f"במרחק {row['distance_km']} ק\"מ מהנכס. נדרשת סריקה ידנית של מנהל הסיכונים."
            )

            duplicate = db.scalar(
                select(models.Incident)
                .where(models.Incident.property_id == row["property_id"])
                .where(models.Incident.hazard_type == "STRUCTURAL_FAILURE")
                .where(models.Incident.description.like(f"%{event['event_time']}%"))
            )
            if duplicate:
                continue

            incident = models.Incident(
                incident_code=_next_incident_code(db),
                property_id=row["property_id"],
                reported_by_user_id=None,
                incident_timestamp=datetime.now(),
                hazard_type="STRUCTURAL_FAILURE",
                # Unknown until a human inspects the property — MEDIUM/full-operation
                # are the conservative "not yet assessed" defaults for an
                # auto-generated draft, not a claim about actual damage.
                severity_level="MEDIUM",
                operational_impact="FULL_OPERATION",
                initial_estimated_loss=0,
                description=description,
                status="NEW",
                ai_classified=False,
                created_at=datetime.now(),
                is_draft=True,
            )
            db.add(incident)
            db.commit()
            db.refresh(incident)

            # Optional nice-to-have (TODO_SPEC.md §13 item 1): populate
            # resolved_address via reverse geocoding, best-effort — a failed/
            # unavailable geocode must never block the draft incident itself
            # from being created (it's already committed above).
            prop = db.get(models.Property, row["property_id"])
            if prop is not None:
                geocoded = gis.reverse_geocode(float(prop.latitude), float(prop.longitude))
                if geocoded["status"] == "ok":
                    incident.resolved_address = geocoded["address"]
                    db.commit()
                    db.refresh(incident)

            created.append(incident)

    return created


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

        prop = db.get(models.Property, payload.property_id)
        if not prop:
            raise HTTPException(404, "Property not found")

        if not idempotency_key:
            duplicate_cutoff = datetime.now() - timedelta(seconds=_DUPLICATE_WINDOW_SECONDS)
            duplicate = db.scalar(
                select(models.Incident)
                .where(models.Incident.property_id == payload.property_id)
                .where(models.Incident.hazard_type == payload.hazard_type)
                .where(models.Incident.reported_by_user_id == payload.reported_by_user_id)
                .where(models.Incident.created_at >= duplicate_cutoff)
                .order_by(models.Incident.created_at.desc())
            )
            if duplicate:
                return duplicate

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

        if idempotency_key:
            _IDEMPOTENCY_CACHE[idempotency_key] = (time.monotonic(), incident)

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


@router.post("/check-seismic-activity", response_model=list[schemas.IncidentOut])
def trigger_seismic_activity_check(
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_SEISMIC_TRIGGER_ROLES)),
):
    """Manually-triggerable wrapper around `check_seismic_activity` (TODO_SPEC.md
    §13 item 1) — this course project has no real cron/scheduler, so this endpoint
    exists purely so the earthquake-triggered-draft-incident automation can be
    invoked/demoed/tested on demand instead of waiting on a real recurring job. A
    production deployment would call `check_seismic_activity(db)` from an actual
    scheduler instead of/in addition to exposing this endpoint."""
    return check_seismic_activity(db)


_POLICIES_READ_ROLES = ("RISK_MANAGER", "CFO", "PROPERTY_MANAGER", "RISK_OFFICER", "ADJUSTER", "ADMIN")


@router.get("/{incident_id}/eligible-policies", response_model=list[schemas.PolicyOut])
def list_eligible_policies(
    incident_id: int,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_POLICIES_READ_ROLES)),
):
    """Same read-role gate as routers/policies.py (TODO_SPEC.md §3) — this also
    returns PolicyOut (premiums/limits), just scoped to one incident's property."""
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
