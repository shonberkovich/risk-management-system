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

import re

import bleach
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.schemas import EmailCreate, EntityLinkedEmailOut
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

    # Contextual auto-linking (TODO_SPEC.md "משימה 11" step 5, optional) — best
    # effort, never blocks the send itself (see autodetect_entity_links's
    # docstring for why a failed/no-match scan is silent, not an error).
    autodetect_entity_links(db, email)

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


# ---------------------------------------------------------------------------
# Contextual entity linking (TODO_SPEC.md "משימה 11")
# ---------------------------------------------------------------------------


def link_email_to_entity(
    db: Session,
    thread_root_id: int,
    entity_type: str,
    entity_id: int,
    linked_by: int,
    auto_linked: bool = False,
) -> models.EntityEmail:
    """Creates (or, if the same thread is already linked to the same entity,
    returns the existing row for) an Entity_Emails link. `thread_root_id`
    must already be resolved to the thread's root email_id by the caller
    (see models.EntityEmail's docstring for why every link is keyed on the
    root, never an individual reply's id) — this function does not itself
    walk thread_id, so the two call sites (routers/emails.py's manual link
    endpoint, and autodetect_entity_links below) each resolve it exactly
    once rather than this function silently re-deriving it twice.

    Idempotent by design against the model's (email_id, entity_type,
    entity_id) uniqueness constraint: re-linking an already-linked
    (thread, entity) pair returns the existing row instead of raising or
    inserting a duplicate — both a user re-clicking "link" and
    autodetect_entity_links re-scanning a later reply in an
    already-linked thread should be harmless no-ops."""
    existing = db.scalar(
        select(models.EntityEmail).where(
            models.EntityEmail.email_id == thread_root_id,
            models.EntityEmail.entity_type == entity_type,
            models.EntityEmail.entity_id == entity_id,
        )
    )
    if existing is not None:
        return existing

    link = models.EntityEmail(
        email_id=thread_root_id,
        entity_type=entity_type,
        entity_id=entity_id,
        linked_by=linked_by,
        auto_linked=auto_linked,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


def list_linked_threads_for_entity(
    db: Session, entity_type: str, entity_id: int, viewer_id: int
) -> list[models.EntityEmail]:
    """Every Entity_Emails link for (entity_type, entity_id) whose thread the
    *current viewer* actually has mailbox access to — reuses the same
    Email_Recipients-row-per-(email, user) scoping every other emails.py
    endpoint relies on (see routers/emails.py's module docstring), so
    linking a thread to an entity is never itself a way to read mail the
    viewer wasn't addressed on. "Has access" means an Email_Recipients row
    for *any* message in the thread (root or any reply) — a viewer who was
    only CC'd on a later reply, not the original root message, still counts
    as a thread participant, same as GET /api/emails/{id}'s own
    per-viewer thread-membership filter.

    The extra query-per-link below (get_thread, then an access check) is
    O(number of links on this entity) — fine at this demo's scale (a
    handful of links per entity, a handful of messages per thread); a
    single joined query would be the next optimization if that stopped
    being true."""
    links = db.scalars(
        select(models.EntityEmail)
        .where(models.EntityEmail.entity_type == entity_type, models.EntityEmail.entity_id == entity_id)
        .order_by(models.EntityEmail.linked_at.desc())
    ).all()

    visible: list[models.EntityEmail] = []
    for link in links:
        thread_email_ids = [m.email_id for m in get_thread(db, link.email_id)]
        has_access = db.scalar(
            select(models.EmailRecipient.id).where(
                models.EmailRecipient.user_id == viewer_id,
                models.EmailRecipient.email_id.in_(thread_email_ids),
            )
        )
        if has_access is not None:
            visible.append(link)
    return visible


def to_entity_linked_email_out(link: models.EntityEmail) -> EntityLinkedEmailOut:
    """Builds the EntityLinkedEmailOut the entity-scoped GET endpoints return
    (routers/incidents.py, routers/claims.py, routers/properties.py) from an
    EntityEmail row — shared here rather than duplicated in all three
    routers, same "one conversion helper" convention as _to_email_out in
    routers/emails.py."""
    return EntityLinkedEmailOut(
        email_id=link.email.email_id,
        subject=link.email.subject,
        created_at=link.email.created_at,
        sender=link.email.sender,
        linked_by=link.linked_by_user,
        linked_at=link.linked_at,
        auto_linked=link.auto_linked,
    )


# Entity code formats actually used in this repo (TODO_SPEC.md "משימה 11" step
# 5's own example is "INC-2026-001"-shaped):
#   - Incidents.incident_code: "INC-{year}-{seq:03d}"  (routers/incidents.py:_next_incident_code)
#   - Claims.claim_number:     "CLM-{year}-{seq:03d}"  (routers/claims.py:_next_claim_number;
#     seed.py's demo rows use 2-digit sequences like "CLM-2025-01" — \d+ matches either)
#   - Properties.property_code: "PRP-{seq:03d}"        (seed.py, no year segment)
# All three are simple, fixed, unambiguous prefixes, so one plain regex per
# shape reliably finds candidate tokens in free-text subjects without false
# positives against ordinary Hebrew/English subject lines.
_INCIDENT_OR_CLAIM_CODE_RE = re.compile(r"\b(?:INC|CLM)-\d{4}-\d+\b")
_PROPERTY_CODE_RE = re.compile(r"\bPRP-\d+\b")


def autodetect_entity_links(db: Session, email: models.Email) -> list[models.EntityEmail]:
    """TODO_SPEC.md "משימה 11" step 5 (optional): if `email.subject` contains
    an entity-code-shaped token matching this repo's actual code formats
    (see the regexes above), auto-creates an Entity_Emails link
    (auto_linked=True) to the matching entity, credited to the email's own
    sender. Plain regex against a fixed, unambiguous format — not a fuzzy
    match: a token that doesn't resolve to an existing row (typo, made-up
    code, or a code for an entity that doesn't exist) is silently skipped
    rather than erroring, since this is a best-effort convenience on top of
    the manual link endpoint (step 2/3), never a replacement for it and
    never allowed to block the send it's attached to.

    Called from send_email for every newly sent message. Safe to call again
    for the same email (link_email_to_entity is idempotent), so a future
    caller (e.g. re-scanning after an edit, if that's ever added) wouldn't
    create duplicate links either."""
    created: list[models.EntityEmail] = []
    root_id = email.thread_id if email.thread_id is not None else email.email_id

    for code in _INCIDENT_OR_CLAIM_CODE_RE.findall(email.subject):
        if code.startswith("INC-"):
            entity_type, model, field = "INCIDENT", models.Incident, "incident_code"
        else:
            entity_type, model, field = "CLAIM", models.Claim, "claim_number"

        entity = db.scalar(select(model).where(getattr(model, field) == code))
        if entity is None:
            continue
        entity_id = entity.incident_id if entity_type == "INCIDENT" else entity.claim_id
        created.append(link_email_to_entity(db, root_id, entity_type, entity_id, linked_by=email.sender_id, auto_linked=True))

    for code in _PROPERTY_CODE_RE.findall(email.subject):
        prop = db.scalar(select(models.Property).where(models.Property.property_code == code))
        if prop is None:
            continue
        created.append(
            link_email_to_entity(db, root_id, "PROPERTY", prop.property_id, linked_by=email.sender_id, auto_linked=True)
        )

    return created
