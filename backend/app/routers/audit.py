"""Read-only Audit_Log query surface. The rows themselves are written entirely by
`app.middleware.audit.AuditLogMiddleware` (every mutating /api/* request) — this router
only exposes them, filtered/paginated, for the system-admin "who changed what" screen.
ADMIN-only: audit trail contents (old/new request bodies, IPs, per-user activity) are
exactly the kind of data a non-admin role has no legitimate reason to browse.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import require_roles

router = APIRouter(prefix="/api/audit-log", tags=["audit-log"])

_AUDIT_ROLES = ("ADMIN",)


@router.get("", response_model=schemas.AuditLogPageOut)
def list_audit_log(
    entity_type: str | None = Query(None, description="לדוגמה INCIDENTS, CLAIMS, POLICIES"),
    entity_id: int | None = None,
    user_id: int | None = None,
    action: str | None = Query(None, description="CREATE / UPDATE / DELETE"),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = Query(50, gt=0, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_AUDIT_ROLES)),
):
    stmt = select(models.AuditLog)
    count_stmt = select(func.count()).select_from(models.AuditLog)

    if entity_type:
        stmt = stmt.where(models.AuditLog.entity_type == entity_type.upper())
        count_stmt = count_stmt.where(models.AuditLog.entity_type == entity_type.upper())
    if entity_id is not None:
        stmt = stmt.where(models.AuditLog.entity_id == entity_id)
        count_stmt = count_stmt.where(models.AuditLog.entity_id == entity_id)
    if user_id is not None:
        stmt = stmt.where(models.AuditLog.user_id == user_id)
        count_stmt = count_stmt.where(models.AuditLog.user_id == user_id)
    if action:
        stmt = stmt.where(models.AuditLog.action == action.upper())
        count_stmt = count_stmt.where(models.AuditLog.action == action.upper())
    if date_from is not None:
        stmt = stmt.where(models.AuditLog.timestamp >= date_from)
        count_stmt = count_stmt.where(models.AuditLog.timestamp >= date_from)
    if date_to is not None:
        stmt = stmt.where(models.AuditLog.timestamp <= date_to)
        count_stmt = count_stmt.where(models.AuditLog.timestamp <= date_to)

    total = db.scalar(count_stmt) or 0
    rows = db.scalars(
        stmt.order_by(models.AuditLog.timestamp.desc(), models.AuditLog.log_id.desc())
        .offset(offset)
        .limit(limit)
    ).all()

    user_ids = {row.user_id for row in rows if row.user_id is not None}
    names_by_id: dict[int, str] = {}
    if user_ids:
        for uid, name in db.execute(
            select(models.User.user_id, models.User.full_name).where(models.User.user_id.in_(user_ids))
        ):
            names_by_id[uid] = name

    entries = [
        schemas.AuditLogEntryOut(
            log_id=row.log_id,
            user_id=row.user_id,
            user_name=names_by_id.get(row.user_id) if row.user_id is not None else None,
            entity_type=row.entity_type,
            entity_id=row.entity_id,
            action=row.action,
            old_value=row.old_value,
            new_value=row.new_value,
            timestamp=row.timestamp,
            ip_address=row.ip_address,
        )
        for row in rows
    ]

    return schemas.AuditLogPageOut(total=total, limit=limit, offset=offset, entries=entries)


@router.get("/entity-types", response_model=list[str])
def list_entity_types(
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_AUDIT_ROLES)),
):
    """Distinct entity_type values seen so far — powers the filter dropdown without
    hardcoding a vocabulary the middleware derives dynamically from URL paths."""
    rows = db.scalars(select(models.AuditLog.entity_type).distinct().order_by(models.AuditLog.entity_type)).all()
    return list(rows)
