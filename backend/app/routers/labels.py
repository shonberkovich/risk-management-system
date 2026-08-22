"""Custom Folders/Labels CRUD — TODO_SPEC.md "משימה 16": "תמיכה בריבוי תיבות
ויצירת תיקיות מותאמות אישית (Custom Folders/Labels)". The endpoint prefix
(`/api/folders`) is the spec's own literal path even though what this
codebase models is really a Gmail-style *label*, not another mailbox folder —
see models.Label's docstring for why. Attaching/detaching a label to/from an
email thread is a separate pair of endpoints on routers/emails.py
(`POST/DELETE /api/emails/{id}/tags[/...]`), not here — those need that
router's own `_require_recipient_row` mailbox-ownership check first (you must
already be able to see a thread to tag it), the same reason Task 15's AI
endpoints live in emails.py rather than ai.py (see that router's module
docstring).

Every operation here is scoped to `current_user` (TODO_SPEC.md step 1: "כדי
שלכל משתמש יהיו תגיות משלו" — so each user has their own labels). A label_id
that exists but belongs to someone else 404s, not 403 — same non-disclosure
posture Task 5's `_require_recipient_row` established for mailbox ownership:
a caller can't even confirm another user's label_id exists."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import get_current_user
from app.services import email as email_service

router = APIRouter(prefix="/api/folders", tags=["labels"])


@router.get("", response_model=list[schemas.LabelOut])
def list_labels(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return email_service.list_labels_for_user(db, current_user.user_id)


@router.post("", response_model=schemas.LabelOut, status_code=201)
def create_label(
    payload: schemas.LabelCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return email_service.create_label(db, current_user.user_id, payload.name, payload.color)


@router.delete("/{label_id}", status_code=204)
def delete_label(
    label_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    try:
        email_service.delete_label(db, label_id, current_user.user_id)
    except ValueError as exc:
        raise HTTPException(404, "Label not found") from exc
