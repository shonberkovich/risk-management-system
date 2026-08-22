"""Internal Email System REST API (TODO_SPEC.md "משימה 5") — CRUD surface over
`services/email.py` (Task 3): folder-scoped inbox listing, reading a single
message or its full thread, sending, and marking-read/moving-folder.

Authorization model: every endpoint just requires a logged-in user
(`get_current_user`, no `require_roles(...)` restriction) — email is a general
internal tool, not role-gated, per the spec. Per-message access is instead
scoped by *mailbox ownership*: a user may only read/mutate an email they are
the sender or a recipient of. Concretely that means having an
`Email_Recipients` row for `(email_id, user_id)` — note `send_email` (Task 3)
always gives the sender their own folder=SENT copy, so "sender or recipient"
collapses to that one row lookup (`_require_recipient_row` below) for every
endpoint that takes an `email_id`. A caller with no such row gets a 404 (not
403) so the endpoint doesn't even confirm the email_id exists to someone
outside its mailbox — matches this task's own wording ("Must 404 if the
current user has no EmailRecipient row for that email... don't leak emails
outside a user's own inbox/sent/etc.").

GET /api/emails/{id} design choice: always returns `EmailThreadOut`, never a
bare `EmailOut` — a standalone (non-threaded) message comes back as a
single-message thread (`root == messages[0] == that email`). This keeps the
frontend's single email-view component thread-shaped regardless of whether the
opened message has replies, rather than branching on response shape. Thread
membership is additionally scoped per viewer: `get_thread` returns every
message under the thread's root, but the response is filtered down to only
the messages the *current user* also has an Email_Recipients row for. Without
that filter, opening a thread you're partly CC'd on could leak other
participants' messages in the same thread that were never addressed to you —
the per-email 404 check alone only guards the one `email_id` in the URL, not
every message the thread happens to also contain.

Attachments (TODO_SPEC.md "משימה 6"): FastAPI can't cleanly mix a JSON request
body with multipart file parts on one endpoint, so rather than bolt
`files: list[UploadFile]` onto POST /api/emails (which would force it from a
JSON body to a Form-fields-only body, a breaking shape change for the
frontend's Compose feature), attachments are a second step against an
already-created email: POST /api/emails/{id}/attachments, multipart-only,
called after the initial POST /api/emails JSON call returns the new
`email_id`. POST /api/emails's own request/response shape is unchanged.
Uploading attachments is restricted to the email's own sender (see
`_require_sender` below) — it's a continuation of composing your own message,
not something a recipient does to mail they received. Downloading them reuses
routers/media.py's existing GET /api/media/download (see
get_attachment_signed_url below) rather than standing up a third near-identical
copy of that endpoint (media.py and documents.py already each have one) — that
endpoint validates by signed token alone, not by entity type, so it works
unmodified for any storage key including "emails/...".
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import get_current_user
from app.services import email as email_service
from app.services import storage

router = APIRouter(prefix="/api/emails", tags=["emails"])

_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024  # 25 MB per file — same ceiling as media.py/documents.py uploads


def _require_recipient_row(db: Session, email_id: int, user_id: int) -> models.EmailRecipient:
    """The router-level counterpart to services.email._get_recipient_row: same
    (email_id, user_id) lookup, but raises the 404 HTTPException every endpoint
    below needs instead of a bare ValueError (which _get_recipient_row raises
    for the service layer's own internal use, e.g. from mark_as_read/
    move_to_folder). See module docstring for why this is 404, not 403."""
    row = db.scalars(
        select(models.EmailRecipient).where(
            models.EmailRecipient.email_id == email_id,
            models.EmailRecipient.user_id == user_id,
        )
    ).first()
    if row is None:
        raise HTTPException(404, "Email not found")
    return row


def _require_sender(db: Session, email_id: int, user_id: int) -> models.Email:
    """Attachment upload's own authorization check: only the email's sender may
    attach files to it (see module docstring). 404, not 403, for "not yours or
    doesn't exist" — same convention as _require_recipient_row, so a caller
    outside the email's mailbox can't distinguish "no such email" from "not
    yours" either way."""
    email = db.get(models.Email, email_id)
    if email is None or email.sender_id != user_id:
        raise HTTPException(404, "Email not found")
    return email


def _to_list_item(row: models.EmailRecipient) -> schemas.EmailListItemOut:
    email = row.email
    return schemas.EmailListItemOut(
        email_id=email.email_id,
        subject=email.subject,
        created_at=email.created_at,
        sender=email.sender,
        thread_id=email.thread_id,
        is_read=row.is_read,
        folder=row.folder,
    )


@router.get("", response_model=list[schemas.EmailListItemOut])
def list_emails(
    folder: schemas.EmailFolder = "INBOX",
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    rows = email_service.list_emails_for_user(db, current_user.user_id, folder, skip=skip, limit=limit)
    return [_to_list_item(row) for row in rows]


@router.get("/{email_id}", response_model=schemas.EmailThreadOut)
def get_email(
    email_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _require_recipient_row(db, email_id, current_user.user_id)
    email = db.get(models.Email, email_id)
    if email is None:
        raise HTTPException(404, "Email not found")

    thread_root_id = email.thread_id if email.thread_id is not None else email.email_id
    all_messages = email_service.get_thread(db, thread_root_id)

    # Scope the thread to messages the current user actually has a mailbox copy
    # of — see module docstring. The requested email_id is always included
    # (the _require_recipient_row check above already guarantees a row for it).
    visible_ids = set(db.scalars(
        select(models.EmailRecipient.email_id).where(
            models.EmailRecipient.user_id == current_user.user_id,
            models.EmailRecipient.email_id.in_([m.email_id for m in all_messages]),
        )
    ).all())
    messages = [m for m in all_messages if m.email_id in visible_ids]
    root = next((m for m in messages if m.thread_id is None), messages[0])
    return schemas.EmailThreadOut(root=root, messages=messages)


@router.post("", response_model=schemas.EmailOut, status_code=201)
def send_email(
    payload: schemas.EmailCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    for user_id in {*payload.to, *payload.cc, *payload.bcc}:
        if db.get(models.User, user_id) is None:
            raise HTTPException(404, f"Recipient user_id {user_id} not found")

    try:
        email = email_service.send_email(db, current_user.user_id, payload)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return email


@router.patch("/{email_id}/read", response_model=schemas.EmailRecipientOut)
def mark_email_read(
    email_id: int,
    payload: schemas.MarkAsRead,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _require_recipient_row(db, email_id, current_user.user_id)
    return email_service.mark_as_read(db, email_id, current_user.user_id, payload.is_read)


@router.patch("/{email_id}/folder", response_model=schemas.EmailRecipientOut)
def move_email_folder(
    email_id: int,
    payload: schemas.MoveToFolder,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    _require_recipient_row(db, email_id, current_user.user_id)
    return email_service.move_to_folder(db, email_id, current_user.user_id, payload.folder)


@router.post("/{email_id}/attachments", response_model=list[schemas.EmailAttachmentOut], status_code=201)
async def add_email_attachments(
    email_id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    email = _require_sender(db, email_id, current_user.user_id)

    pending: list[tuple[str, bytes]] = []
    for file in files:
        if not file.filename:
            raise HTTPException(400, "חסר שם קובץ")
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(400, "הקובץ ריק")
        if len(file_bytes) > _MAX_ATTACHMENT_BYTES:
            raise HTTPException(400, f"הקובץ חורג מהגודל המרבי המותר ({_MAX_ATTACHMENT_BYTES // (1024 * 1024)}MB)")
        pending.append((file.filename, file_bytes))

    return email_service.add_attachments(db, email, pending)


@router.get("/attachments/{attachment_id}/signed-url", response_model=schemas.SignedUrlOut)
def get_attachment_signed_url(
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    attachment = db.get(models.EmailAttachment, attachment_id)
    if attachment is None:
        raise HTTPException(404, "Attachment not found")
    # Sender-or-recipient check (see module docstring) — same (email_id, user_id)
    # Email_Recipients lookup Task 5's other endpoints use, keyed off the
    # attachment's parent email rather than duplicating that logic here.
    _require_recipient_row(db, attachment.email_id, current_user.user_id)

    signed = storage.generate_signed_url(attachment.file_path)
    return {
        **signed,
        "download_url": (
            f"/api/media/download?key={signed['storage_key']}"
            f"&expires={signed['expires_at']}&token={signed['token']}"
        ),
    }
