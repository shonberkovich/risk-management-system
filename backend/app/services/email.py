"""Core service for sending and managing the internal email system
(TODO_SPEC.md, "משימה 3": send + fan-out to recipient folders + thread
linkage + folder/read-state management). Plain functions taking a SQLAlchemy
`Session` — no FastAPI dependencies here (same service-layer convention as
`notifications.py`/`retention.py`); Task 5's router is responsible for auth
and turning `ValueError`s raised here into HTTP error responses.

Thread model recap (see `models.Email`'s docstring for the full rationale):
`Email.thread_id` is a self-referencing FK that always points at the
thread's *root* email — never at an intermediate reply. The root itself has
`thread_id = NULL`. That means resolving `EmailCreate.in_reply_to` (which
names the specific message being replied to, not necessarily the root) takes
one lookup: if the referenced email already has a `thread_id`, that's the
root; otherwise the referenced email *is* the root. This is what
`_resolve_thread_root_id` below does, and it's why replying to a reply still
lands in the same thread as replying to the root.
"""
from __future__ import annotations

import bleach
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.schemas import EmailCreate
from app.services import sse_manager, storage

# TODO_SPEC.md "משימה 10" step 2 — XSS defense for Email.body_html. A small, fixed
# subset of formatting tags (mirrors what EmailComposeModal.tsx's own
# plainTextToHtml actually emits today — <p>/<br/> — plus a few more a future rich-
# text editor is likely to add: bold/italic/underline/lists/links/quotes) and, for
# <a>, only the href attribute. Everything else — script, style, iframe, event
# handlers (onclick/onerror/...), inline style attributes, javascript:/data: hrefs —
# is stripped outright by bleach.clean(strip=True), not merely HTML-escaped. Note
# `strip=True` removes the *tag* but keeps a disallowed element's inner text as
# plain inert content (e.g. "<script>alert(1)</script>" -> "alert(1)", visible but
# non-executable) rather than deleting the text too — that's bleach's documented
# behavior and is fine here: the point is "can never execute", not "must vanish".
ALLOWED_BODY_TAGS = ["p", "br", "b", "i", "u", "strong", "em", "ul", "ol", "li", "a", "blockquote"]
ALLOWED_BODY_ATTRIBUTES = {"a": ["href"]}
ALLOWED_BODY_PROTOCOLS = ["http", "https", "mailto"]


def sanitize_body_html(html: str) -> str:
    """The one sanitization call site every write *and* read of body_html funnels
    through — see this module's docstring intro and routers/emails.py's
    `_to_email_out` for why it's applied on both sides ("never trust one layer"):
    `send_email` below sanitizes before the very first write, so newly-sent mail can
    never contain unsafe markup in the database at all; the router re-sanitizes on
    the way *out* of every read too, as defense-in-depth for the handful of rows
    Tasks 3/5/6/7/8 already wrote (seed/test fixtures) before this function existed.
    Deliberately not a one-off backfill migration script instead: those rows are
    few, this call is cheap, and re-sanitizing on every read is self-healing forever
    after — including for any future write path that might bypass send_email —
    rather than a point-in-time fix that stale code could still undo."""
    return bleach.clean(
        html,
        tags=ALLOWED_BODY_TAGS,
        attributes=ALLOWED_BODY_ATTRIBUTES,
        protocols=ALLOWED_BODY_PROTOCOLS,
        strip=True,
    )


# recipient_type used for the sender's own folder=SENT copy of an email they sent.
# EmailRecipient.recipient_type is otherwise only ever TO/CC/BCC (mirroring who the
# message was actually addressed to); there's no dedicated "sender" value in that
# set, and EmailRecipientOut's Literal only allows TO/CC/BCC. Reusing "TO" is a
# harmless fiction — it never has to be distinguished from a real TO recipient,
# because a sender's copy is identified by folder="SENT", not by recipient_type.
SENDER_COPY_RECIPIENT_TYPE = "TO"


def _resolve_thread_root_id(db: Session, in_reply_to: int) -> int:
    """`in_reply_to` is the email_id of the message being replied to (not
    necessarily the thread root — see module docstring). Returns the id of the
    thread's actual root: the referenced email's own `thread_id` if it has one
    (i.e. it was itself a reply), else the referenced email's own `email_id`
    (i.e. it was itself the root)."""
    parent = db.get(models.Email, in_reply_to)
    if parent is None:
        raise ValueError(f"in_reply_to references a nonexistent email_id: {in_reply_to}")
    return parent.thread_id if parent.thread_id is not None else parent.email_id


def send_email(db: Session, sender_id: int, email_in: EmailCreate) -> models.Email:
    """Creates the Email row, resolves thread linkage, and fans the message out
    to every recipient's INBOX plus the sender's own SENT copy. Commits and
    returns the persisted, refreshed Email."""
    thread_id = (
        _resolve_thread_root_id(db, email_in.in_reply_to)
        if email_in.in_reply_to is not None
        else None
    )

    email = models.Email(
        sender_id=sender_id,
        subject=email_in.subject,
        body_html=sanitize_body_html(email_in.body_html),
        thread_id=thread_id,
        status="SENT",
    )
    db.add(email)
    db.flush()  # assigns email.email_id so the recipient rows below can reference it

    for recipient_type, user_ids in (
        ("TO", email_in.to),
        ("CC", email_in.cc),
        ("BCC", email_in.bcc),
    ):
        for user_id in user_ids:
            db.add(models.EmailRecipient(
                email_id=email.email_id,
                user_id=user_id,
                recipient_type=recipient_type,
                folder="INBOX",
                is_read=False,
            ))

    # The sender's own copy: it's their outgoing mail, not something unread waiting
    # for them, so is_read=True and it lives in SENT rather than INBOX.
    db.add(models.EmailRecipient(
        email_id=email.email_id,
        user_id=sender_id,
        recipient_type=SENDER_COPY_RECIPIENT_TYPE,
        folder="SENT",
        is_read=True,
    ))

    db.commit()
    db.refresh(email)

    # Real-time nudge (TODO_SPEC.md "משימה 4"): push a `new_email` event to every
    # addressed recipient's open SSE connection(s), if any — see
    # sse_manager.ConnectionManager's docstring for why this is a safe no-op for a
    # recipient with no tab currently open. Deliberately excludes the sender (their
    # own SENT copy isn't "new mail" for them) and keeps the payload minimal — just
    # enough for the frontend to show a toast and invalidate its mailbox query,
    # not the full email body. `thread_id` falls back to the email's own id so the
    # frontend always has a thread to navigate to, matching how a fresh root has
    # `thread_id = NULL` on the model (see models.Email's docstring).
    event = {
        "type": "new_email",
        "email_id": email.email_id,
        "thread_id": email.thread_id if email.thread_id is not None else email.email_id,
        "subject": email.subject,
        "sender_id": email.sender_id,
        "created_at": email.created_at.isoformat(),
    }
    recipient_ids = {*email_in.to, *email_in.cc, *email_in.bcc}
    for user_id in recipient_ids:
        sse_manager.broadcast(user_id, event)

    return email


def add_attachments(
    db: Session, email: models.Email, files: list[tuple[str, bytes]]
) -> list[models.EmailAttachment]:
    """Persists each (filename, file_bytes) pair via storage.upload_file under
    entity_type="EMAIL" (-> media_storage/emails/<email_id>/<filename>, TODO_SPEC.md
    "משימה 6" step 1) and creates the matching EmailAttachment row. Deliberately a
    separate call from send_email rather than folded into it: routers/emails.py's
    POST /api/emails/{id}/attachments is a second step against an *already-created*
    email (the email needs its own id first — see that router's module docstring)
    rather than something bundled into the original multipart-free POST /api/emails
    JSON body. storage.py stays the only thing that actually touches disk; this is
    just the DB-row bookkeeping around it, same division of labor send_email keeps
    with EmailRecipient rows."""
    attachments = []
    for filename, file_bytes in files:
        upload_result = storage.upload_file(file_bytes, filename, "EMAIL", email.email_id)
        attachment = models.EmailAttachment(
            email_id=email.email_id,
            file_path=upload_result.storage_key,
            file_name=filename,
            file_size=upload_result.size_bytes,
            content_type=upload_result.content_type,
        )
        db.add(attachment)
        attachments.append(attachment)

    db.commit()
    for attachment in attachments:
        db.refresh(attachment)
    return attachments


def get_thread(db: Session, thread_root_id: int) -> list[models.Email]:
    """All messages belonging to the thread rooted at `thread_root_id` (the root
    itself plus every reply whose thread_id points at it), oldest first. Matches
    the flat query documented on `models.Email`: no parent-chain walk needed
    since every reply's thread_id already points straight at the root."""
    return list(db.scalars(
        select(models.Email)
        .where((models.Email.email_id == thread_root_id) | (models.Email.thread_id == thread_root_id))
        .order_by(models.Email.created_at, models.Email.email_id)
    ).all())


def _get_recipient_row(db: Session, email_id: int, user_id: int) -> models.EmailRecipient:
    """Looks up the Email_Recipients row for (email_id, user_id) — the natural key
    a router acting "on behalf of the current user" identifies a mailbox copy by,
    rather than the surrogate EmailRecipient.id (which callers outside this module
    never need to know). Raises ValueError if the user has no copy of that email
    (e.g. it wasn't addressed to them), so Task 5's router can turn that into a
    404/403 as appropriate."""
    row = db.scalars(
        select(models.EmailRecipient).where(
            models.EmailRecipient.email_id == email_id,
            models.EmailRecipient.user_id == user_id,
        )
    ).first()
    if row is None:
        raise ValueError(f"No Email_Recipients row for email_id={email_id}, user_id={user_id}")
    return row


def move_to_folder(db: Session, email_id: int, user_id: int, folder: str) -> models.EmailRecipient:
    """Moves `user_id`'s copy of `email_id` to `folder` (INBOX/ARCHIVE/TRASH/SPAM/
    SENT — see schemas.EmailFolder)."""
    row = _get_recipient_row(db, email_id, user_id)
    row.folder = folder
    db.commit()
    db.refresh(row)
    return row


def archive_email(db: Session, email_id: int, user_id: int) -> models.EmailRecipient:
    """Thin wrapper: move_to_folder(..., folder="ARCHIVE")."""
    return move_to_folder(db, email_id, user_id, "ARCHIVE")


def trash_email(db: Session, email_id: int, user_id: int) -> models.EmailRecipient:
    """Thin wrapper: move_to_folder(..., folder="TRASH")."""
    return move_to_folder(db, email_id, user_id, "TRASH")


def mark_as_read(db: Session, email_id: int, user_id: int, is_read: bool) -> models.EmailRecipient:
    """Sets `user_id`'s copy of `email_id` read/unread. `is_read` is required
    (not just "mark read") — mirrors schemas.MarkAsRead, which supports marking a
    message unread again too."""
    row = _get_recipient_row(db, email_id, user_id)
    row.is_read = is_read
    db.commit()
    db.refresh(row)
    return row


def list_emails_for_user(
    db: Session,
    user_id: int,
    folder: str,
    skip: int = 0,
    limit: int = 50,
    q: str | None = None,
) -> list[models.EmailRecipient]:
    """Folder-scoped, paginated listing of `user_id`'s mailbox copies (newest
    email first) — owns the query GET /api/emails (Task 5) needs, so the router
    doesn't have to duplicate it.

    `q` (TODO_SPEC.md "משימה 10" step 4) is an optional free-text filter over
    subject, body_html, and the sender's full_name — a plain `LIKE '%q%'` on each
    column, OR'd together, same shape as the only other free-text search already in
    this codebase (routers/incidents.py's `Incident.description.like(...)`); this
    repo has no full-text-search extension configured, so a fancier ranked/indexed
    search is out of scope here. Matches against the *stored* body_html (i.e.
    against post-sanitization markup, tags included) — acceptable for a simple demo
    search box; a reader wanting to search rendered text only would need to strip
    tags first, which isn't worth the extra complexity for this task."""
    query = (
        select(models.EmailRecipient)
        .join(models.Email, models.EmailRecipient.email_id == models.Email.email_id)
        .join(models.User, models.Email.sender_id == models.User.user_id)
        .where(
            models.EmailRecipient.user_id == user_id,
            models.EmailRecipient.folder == folder,
        )
    )
    if q:
        like = f"%{q}%"
        query = query.where(
            models.Email.subject.like(like)
            | models.Email.body_html.like(like)
            | models.User.full_name.like(like)
        )
    return list(db.scalars(
        query
        .order_by(models.Email.created_at.desc(), models.Email.email_id.desc())
        .offset(skip)
        .limit(limit)
    ).all())
