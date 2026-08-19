"""Mitigation task CRUD: creation, updates (including executor assignment and
closing), automatic OVERDUE status calculation, and an ROI breakdown endpoint.

Automatic OVERDUE calculation: MitigationStatus is one of OPEN / IN_PROGRESS /
COMPLETED / OVERDUE, but "overdue" is really a derived fact about due_date vs.
today, not an independent state a caller should have to set by hand. _sync_overdue
recomputes it on every read/write: a task whose due_date has passed and that
isn't COMPLETED is forced to OVERDUE (even if the caller just set it to
IN_PROGRESS in the same request — being "in progress" doesn't stop a task from
being late); a task that's OVERDUE but whose due_date has since moved to the
future (or is COMPLETED) is not automatically OVERDUE anymore. COMPLETED is the
one state that is never overridden by the date check, matching "סגירה" (closing)
as a genuinely terminal action.
"""
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import require_roles
from app.services.kpi import calculate_mitigation_roi, calculate_mitigation_roi_breakdown

router = APIRouter(prefix="/api/mitigation-tasks", tags=["mitigation"])

_MITIGATION_WRITE_ROLES = ("RISK_MANAGER", "PROPERTY_MANAGER", "ADMIN")


def _sync_overdue(task: models.MitigationTask) -> None:
    """See module docstring. Mutates task.status in place; caller is responsible
    for committing."""
    if task.status == "COMPLETED":
        return
    if task.due_date < date.today():
        task.status = "OVERDUE"
    elif task.status == "OVERDUE":
        task.status = "OPEN"


def _to_out(task: models.MitigationTask) -> schemas.MitigationTaskOut:
    return schemas.MitigationTaskOut(
        task_id=task.task_id,
        property_id=task.property_id,
        title=task.title,
        cost_estimate=float(task.cost_estimate),
        expected_annual_savings=float(task.expected_annual_savings),
        due_date=task.due_date,
        status=task.status,
        assigned_to_user_id=task.assigned_to_user_id,
        roi_percent=calculate_mitigation_roi(task),
    )


@router.get("", response_model=list[schemas.MitigationTaskOut])
def list_tasks(db: Session = Depends(get_db)):
    tasks = db.scalars(select(models.MitigationTask).order_by(models.MitigationTask.due_date)).all()
    for task in tasks:
        _sync_overdue(task)
    db.commit()
    return [_to_out(t) for t in tasks]


@router.get("/{task_id}", response_model=schemas.MitigationTaskOut)
def get_task(task_id: int, db: Session = Depends(get_db)):
    task = db.get(models.MitigationTask, task_id)
    if not task:
        raise HTTPException(404, "Mitigation task not found")
    _sync_overdue(task)
    db.commit()
    return _to_out(task)


@router.post("", response_model=schemas.MitigationTaskOut, status_code=201)
def create_task(
    payload: schemas.MitigationTaskCreate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_MITIGATION_WRITE_ROLES)),
):
    property_ = db.get(models.Property, payload.property_id)
    if not property_:
        raise HTTPException(404, "Property not found")
    if payload.assigned_to_user_id is not None and not db.get(models.User, payload.assigned_to_user_id):
        raise HTTPException(404, "Assigned user not found")

    task = models.MitigationTask(
        property_id=payload.property_id,
        title=payload.title,
        cost_estimate=payload.cost_estimate,
        expected_annual_savings=payload.expected_annual_savings,
        due_date=payload.due_date,
        status="OPEN",
        assigned_to_user_id=payload.assigned_to_user_id,
        created_at=datetime.now(),
    )
    _sync_overdue(task)
    db.add(task)
    db.commit()
    db.refresh(task)
    return _to_out(task)


@router.patch("/{task_id}", response_model=schemas.MitigationTaskOut)
def update_task(
    task_id: int,
    payload: schemas.MitigationTaskUpdate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_MITIGATION_WRITE_ROLES)),
):
    task = db.get(models.MitigationTask, task_id)
    if not task:
        raise HTTPException(404, "Mitigation task not found")

    updates = payload.model_dump(exclude_unset=True)
    if "assigned_to_user_id" in updates and updates["assigned_to_user_id"] is not None:
        if not db.get(models.User, updates["assigned_to_user_id"]):
            raise HTTPException(404, "Assigned user not found")

    for field, value in updates.items():
        setattr(task, field, value)

    _sync_overdue(task)
    db.commit()
    db.refresh(task)
    return _to_out(task)


@router.get("/{task_id}/roi", response_model=schemas.MitigationRoiBreakdown)
def get_task_roi(task_id: int, db: Session = Depends(get_db)):
    breakdown = calculate_mitigation_roi_breakdown(db, task_id)
    if breakdown is None:
        raise HTTPException(404, "Mitigation task not found")
    return breakdown
