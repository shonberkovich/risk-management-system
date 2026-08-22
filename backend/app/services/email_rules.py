"""Auto-filter engine for TODO_SPEC.md "משימה 17" ("כללי סינון אוטומטיים
(Email Rules/Filters)") — the spec's own worked example: "if the email subject
contains the word 'urgent', star it and add a red label". A rule is a plain,
explicit "if [condition(s)] then [action(s)]" record (models.EmailRule),
deliberately NOT a generic expression language — per this task's own modest
ask (step 3's "תפריטים קופצים", pop-up-menu pickers, not a code editor):

    conditions = [{"field": "subject"|"sender"|"body", "operator": "contains"|
                   "equals", "value": "..."}, ...]   # ANDed together
    actions    = [{"type": "add_label"|"move_to_folder"|"mark_as_read",
                   "value": "..."}, ...]              # all applied on match

See schemas.EmailRuleCondition/EmailRuleAction for the validated shape a rule
is created with, and models.EmailRule's docstring for why these are stored as
JSON text rather than real columns/child tables (same NVARCHAR(MAX)-as-JSON
convention as Agent_Sessions.context_data / Email.scheduled_recipients).

Wiring (spec step 2): `evaluate_rules_for_recipient` is called from
`services/email.py`'s `_fan_out_recipients` — the one fan-out helper shared by
both `send_email` (immediate) and `process_due_scheduled_emails` (Task 13) —
once per TO/CC/BCC `Email_Recipients` row it creates, right after that row is
added and *before* `send_email`'s own single closing `db.commit()`. It is
never called for the sender's own SENT copy: a rule is about incoming mail,
not a reflection of your own outgoing message. Deliberately a plain function
taking the already-open `Session` (no commit of its own — see
`evaluate_rules_for_recipient`'s docstring) so it mutates the exact same
transaction the caller is already inside, matching how `autodetect_entity_links`
and `_broadcast_new_email_event` are already shared across both send paths.

Performance (spec step 5, "וידוא ביצועים למניעת האטה בזמן חלוקת מייל בעקבות
ריבוי חוקים" — don't let many rules slow down fan-out to a whole distribution
list): each call does exactly one query (this recipient's own active rules,
loaded once) and then a plain in-memory loop over that small list — no
query-per-rule, no query-per-condition. `email.sender` is a lazily-loaded
relationship that SQLAlchemy caches on the `Email` instance after its first
access, so across N recipients of the same send it's fetched at most once
total, not once per recipient."""
from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas

# Mirrors schemas.EmailFolder's value set (see that Literal's own docstring) —
# the valid targets for a "move_to_folder" action. Kept as a local tuple
# rather than importing the Literal itself so an unrecognized/stale folder
# value written by some future schema change fails safe (silently skipped,
# see _apply_action) instead of raising deep inside a send.
_VALID_FOLDERS = {"INBOX", "ARCHIVE", "TRASH", "SPAM"}


def serialize_conditions(conditions: list[schemas.EmailRuleCondition]) -> str:
    """JSON-encodes a validated `EmailRuleCreate.conditions` list for
    `EmailRule.conditions` — same "structured data as NVARCHAR(MAX) JSON text"
    convention as `services/email.serialize_scheduled_recipients`."""
    return json.dumps([c.model_dump() for c in conditions])


def serialize_actions(actions: list[schemas.EmailRuleAction]) -> str:
    """JSON-encodes a validated `EmailRuleCreate.actions` list for
    `EmailRule.actions`. See `serialize_conditions`."""
    return json.dumps([a.model_dump() for a in actions])


def deserialize_conditions(raw: str | None) -> list[dict]:
    """Inverse of `serialize_conditions`. `raw=None`/empty decodes to an empty
    list rather than raising — defensive the same way
    `services/email.deserialize_scheduled_recipients` is, even though every
    row is written by `create_rule` below and should never actually be empty."""
    if not raw:
        return []
    return json.loads(raw)


def deserialize_actions(raw: str | None) -> list[dict]:
    """Inverse of `serialize_actions`. See `deserialize_conditions`."""
    if not raw:
        return []
    return json.loads(raw)


def to_email_rule_out(rule: models.EmailRule) -> schemas.EmailRuleOut:
    """Builds the outward-facing EmailRuleOut for a stored EmailRule row —
    deserializes the JSON-text conditions/actions columns into the structured
    lists schemas.EmailRuleOut expects (it isn't `from_attributes=True` off
    the raw ORM row for exactly this reason; see that schema's docstring)."""
    return schemas.EmailRuleOut(
        id=rule.id,
        user_id=rule.user_id,
        name=rule.name,
        conditions=[schemas.EmailRuleCondition(**c) for c in deserialize_conditions(rule.conditions)],
        actions=[schemas.EmailRuleAction(**a) for a in deserialize_actions(rule.actions)],
        is_active=rule.is_active,
        created_at=rule.created_at,
    )


# ---------------------------------------------------------------------------
# CRUD (POST/GET/DELETE /api/rules — Task 17 step 1/3)
# ---------------------------------------------------------------------------


def create_rule(
    db: Session,
    user_id: int,
    name: str,
    conditions: list[schemas.EmailRuleCondition],
    actions: list[schemas.EmailRuleAction],
    is_active: bool = True,
) -> models.EmailRule:
    """POST /api/rules — creates a new rule owned by `user_id`. No uniqueness
    constraint on `name` — same "harmless user choice, not a data-integrity
    problem" posture as `services/email.create_label`."""
    rule = models.EmailRule(
        user_id=user_id,
        name=name,
        conditions=serialize_conditions(conditions),
        actions=serialize_actions(actions),
        is_active=is_active,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


def list_rules_for_user(db: Session, user_id: int) -> list[models.EmailRule]:
    """GET /api/rules — only `user_id`'s own rules (models.EmailRule's
    docstring: rules are strictly per-user, both to manage and to evaluate)."""
    return list(db.scalars(
        select(models.EmailRule).where(models.EmailRule.user_id == user_id).order_by(models.EmailRule.id)
    ).all())


def delete_rule(db: Session, rule_id: int, user_id: int) -> None:
    """DELETE /api/rules/{id}. Raises ValueError for the router to translate
    into a 404 — same not-yours-vs-doesn't-exist non-disclosure convention as
    `services/email.delete_label`."""
    rule = db.get(models.EmailRule, rule_id)
    if rule is None or rule.user_id != user_id:
        raise ValueError("not found")
    db.delete(rule)
    db.commit()


# ---------------------------------------------------------------------------
# Matching + application (Task 17 step 2, wired into services/email.py)
# ---------------------------------------------------------------------------


def _condition_matches(condition: dict, email: models.Email, sender_email: str) -> bool:
    """Whether one condition dict matches `email`. Matching is
    case-insensitive on both sides (a "URGENT" filter should still catch
    "Urgent deadline" — the spec's own example reads as a casual keyword
    filter, not a strict string-equality tool) and against the message's
    already-sanitized `body_html` for the `body` field (the same stored text
    every other reader of this column sees — see
    `services/email.sanitize_body_html`'s docstring). An unrecognized
    `field`/`operator` (e.g. a future schema change, or a hand-edited row)
    fails safe: it never matches, so a malformed condition can silently no-op
    a rule but can never fire an action it wasn't actually configured for."""
    field = condition.get("field")
    if field == "subject":
        haystack = email.subject or ""
    elif field == "sender":
        haystack = sender_email
    elif field == "body":
        haystack = email.body_html or ""
    else:
        return False

    value = (condition.get("value") or "").strip().lower()
    haystack = haystack.strip().lower()
    operator = condition.get("operator")
    if operator == "contains":
        return value in haystack
    if operator == "equals":
        return haystack == value
    return False


def _apply_action(
    db: Session, action: dict, user_id: int, thread_root_id: int, recipient_row: models.EmailRecipient
) -> None:
    """Applies one action dict to `recipient_row` (this recipient's own mailbox
    copy) — mutates the passed-in ORM objects only, never calls `db.commit()`/
    `db.refresh()` itself (see module docstring: the caller's transaction owns
    that). Every branch fails safe on bad/stale input rather than raising —
    a rule referencing a since-deleted label, or a hand-edited/legacy row with
    an unrecognized action `type`/folder value, is simply skipped, since a
    background rules pass must never be the reason a send itself fails."""
    action_type = action.get("type")

    if action_type == "add_label":
        # Mirrors services/email.add_label_to_email's own (email_id, label_id)
        # idempotency check, but deliberately reimplemented rather than called
        # directly: that function commits internally, which would violate this
        # module's "one shared transaction, one caller-owned commit" contract
        # (see module docstring). Label ownership is re-checked here (not just
        # trusted from rule-creation time) in case the label was deleted or
        # reassigned since the rule was saved — same non-disclosure-adjacent
        # "don't act on an id that isn't yours" posture as every other label
        # touch-point in this codebase.
        try:
            label_id = int(action.get("value"))
        except (TypeError, ValueError):
            return
        label = db.get(models.Label, label_id)
        if label is None or label.user_id != user_id:
            return
        existing = db.scalar(
            select(models.EmailLabel).where(
                models.EmailLabel.email_id == thread_root_id,
                models.EmailLabel.label_id == label_id,
            )
        )
        if existing is None:
            db.add(models.EmailLabel(email_id=thread_root_id, label_id=label_id))
            # This session is autoflush=False (app/database.py's SessionLocal,
            # and the test `db` fixture both set it explicitly) — without an
            # explicit flush here, a *second* matching rule in the same
            # evaluate_rules_for_recipient call whose action also adds this
            # same label would run the `existing` query above against
            # not-yet-flushed state, miss the pending insert just made, and
            # add a duplicate row that only fails at the caller's eventual
            # commit (UNIQUE constraint on (email_id, label_id)) — a
            # confusing, action-at-a-distance failure for what should be a
            # harmless idempotent no-op. Flushing (not committing — see
            # module docstring on why this function never commits) makes the
            # just-added row visible to that next `existing` check within the
            # same still-open transaction.
            db.flush()

    elif action_type == "move_to_folder":
        folder = action.get("value")
        if folder in _VALID_FOLDERS:
            recipient_row.folder = folder

    elif action_type == "mark_as_read":
        recipient_row.is_read = True


def evaluate_rules_for_recipient(
    db: Session, user_id: int, email: models.Email, recipient_row: models.EmailRecipient
) -> None:
    """The engine's single entry point (called from services/email.py's
    `_fan_out_recipients` — see module docstring). Loads `user_id`'s own
    active rules once (creation-id order — see models.EmailRule's docstring
    on why that's an acceptable tie-breaker here), evaluates each rule's
    conditions (ANDed) against `email`, and applies every action of every
    matching rule to `recipient_row`. A no-op, one-query early return if the
    user has no active rules at all — the common case for most recipients,
    so a user with zero rules pays only that one cheap lookup, never a
    per-condition or per-action query.

    Pure aside from that one read query plus the in-memory mutations
    `_apply_action` makes (and, only for `add_label`, a possible
    `db.add(EmailLabel(...))`) — no I/O beyond this session, no commit, easily
    unit-testable against an in-memory DB session without going through
    `send_email` at all."""
    rules = db.scalars(
        select(models.EmailRule)
        .where(models.EmailRule.user_id == user_id, models.EmailRule.is_active == True)  # noqa: E712
        .order_by(models.EmailRule.id)
    ).all()
    if not rules:
        return

    sender_email = email.sender.email if email.sender is not None else ""
    thread_root_id = email.thread_id if email.thread_id is not None else email.email_id

    for rule in rules:
        conditions = deserialize_conditions(rule.conditions)
        if not conditions or not all(_condition_matches(c, email, sender_email) for c in conditions):
            continue
        for action in deserialize_actions(rule.actions):
            _apply_action(db, action, user_id, thread_root_id, recipient_row)
