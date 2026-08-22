"""Email_Templates CRUD — TODO_SPEC.md "משימה 12", "תמיכה בתבניות מייל
מוגדרות מראש (Email Templates)".

Authorization model mirrors routers/role_permissions.py exactly: curating the
template library (create/update/delete) is ADMIN-only (spec step 2: "חשיפת
API לניהול תבניות (CRUD) - מוגבל למנהלים"), but *listing*/*reading* templates
is open to any authenticated user (`require_roles()`, no roles = "logged in,
any role") — every role composes email via EmailComposeModal and needs to be
able to pick a template from the picker; only managing the catalog itself is
an administrative action, same distinction users.py/role_permissions.py
already draw between their own read vs. write endpoints.

Variable substitution ({{claim_number}}, {{client_name}}, ...) deliberately
does NOT happen here. This router only ever returns the raw, unsubstituted
`subject_template`/`body_template` text. See
frontend/src/utils/emailTemplates.ts's module docstring for the client-vs-
server rationale: the spec's own step 4/5 wording ("the user edits the text
*after* the template loads and *before* sending") describes the compose
form's plain subject/body state being filled once, not a live/re-rendered
template — so substitution is a pure client-side text transform run at
"template selected" time, using whatever context (claim_number, client_name)
the compose modal was opened with. Doing it server-side would mean either a
second round-trip (GET template, then POST variables to render) for no real
benefit, or exposing the substitution whitelist to the backend for a
purely-textual operation that has no access-control implications (nothing
sensitive is looked up — the caller already supplies the variable values).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import get_current_user, require_roles

router = APIRouter(prefix="/api/email-templates", tags=["email-templates"])

# Same ADMIN-only convention as routers/role_permissions.py/users.py — curating
# the shared template library is an administrative action.
_TEMPLATE_WRITE_ROLES = ("ADMIN",)


@router.get("", response_model=list[schemas.EmailTemplateOut])
def list_email_templates(
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    stmt = select(models.EmailTemplate).order_by(models.EmailTemplate.name)
    return db.scalars(stmt).all()


@router.get("/{template_id}", response_model=schemas.EmailTemplateOut)
def get_email_template(
    template_id: int,
    db: Session = Depends(get_db),
    _user: models.User = Depends(get_current_user),
):
    row = db.get(models.EmailTemplate, template_id)
    if row is None:
        raise HTTPException(404, "Email template not found")
    return row


@router.post("", response_model=schemas.EmailTemplateOut, status_code=201)
def create_email_template(
    payload: schemas.EmailTemplateCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles(*_TEMPLATE_WRITE_ROLES)),
):
    row = models.EmailTemplate(**payload.model_dump(), created_by=current_user.user_id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{template_id}", response_model=schemas.EmailTemplateOut)
def update_email_template(
    template_id: int,
    payload: schemas.EmailTemplateUpdate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_TEMPLATE_WRITE_ROLES)),
):
    row = db.get(models.EmailTemplate, template_id)
    if row is None:
        raise HTTPException(404, "Email template not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{template_id}", status_code=204)
def delete_email_template(
    template_id: int,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_TEMPLATE_WRITE_ROLES)),
):
    row = db.get(models.EmailTemplate, template_id)
    if row is None:
        raise HTTPException(404, "Email template not found")
    db.delete(row)
    db.commit()
