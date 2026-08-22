"""Email Rules/Filters CRUD — TODO_SPEC.md "משימה 17": "כללי סינון אוטומטיים
(Email Rules/Filters)". `POST /api/rules` is the spec's own literal path;
GET (list) and DELETE are added alongside it following the same per-user-
scoping pattern Task 16's `routers/labels.py` established for `/api/folders`
(see that module's docstring) — a rule_id that exists but belongs to someone
else 404s, not 403, same non-disclosure posture as every other per-user-owned
resource in this codebase.

The actual "evaluate a rule against incoming mail" engine lives in
`services/email_rules.py` and is wired into `services/email.py`'s
`_fan_out_recipients`, not exposed through any endpoint here — this router is
CRUD-only, matching how Task 16's `routers/labels.py` only manages Labels
themselves while the separate tag/attach endpoints live on routers/emails.py."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import get_current_user
from app.services import email_rules as email_rules_service

router = APIRouter(prefix="/api/rules", tags=["email_rules"])


@router.get("", response_model=list[schemas.EmailRuleOut])
def list_rules(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    rules = email_rules_service.list_rules_for_user(db, current_user.user_id)
    return [email_rules_service.to_email_rule_out(r) for r in rules]


@router.post("", response_model=schemas.EmailRuleOut, status_code=201)
def create_rule(
    payload: schemas.EmailRuleCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    rule = email_rules_service.create_rule(
        db,
        current_user.user_id,
        payload.name,
        payload.conditions,
        payload.actions,
        payload.is_active,
    )
    return email_rules_service.to_email_rule_out(rule)


@router.delete("/{rule_id}", status_code=204)
def delete_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    try:
        email_rules_service.delete_rule(db, rule_id, current_user.user_id)
    except ValueError as exc:
        raise HTTPException(404, "Rule not found") from exc
