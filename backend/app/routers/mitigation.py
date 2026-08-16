from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.services.kpi import calculate_mitigation_roi

router = APIRouter(prefix="/api/mitigation-tasks", tags=["mitigation"])


@router.get("", response_model=list[schemas.MitigationTaskOut])
def list_tasks(db: Session = Depends(get_db)):
    tasks = db.scalars(select(models.MitigationTask).order_by(models.MitigationTask.due_date)).all()
    return [
        schemas.MitigationTaskOut(
            task_id=t.task_id,
            property_id=t.property_id,
            title=t.title,
            cost_estimate=float(t.cost_estimate),
            expected_annual_savings=float(t.expected_annual_savings),
            due_date=t.due_date,
            status=t.status,
            roi_percent=calculate_mitigation_roi(t),
        )
        for t in tasks
    ]
