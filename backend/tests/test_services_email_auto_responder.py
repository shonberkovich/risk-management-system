"""Unit tests for the out-of-office / auto-responder hook in app/services/email.py
(TODO_SPEC.md "משימה 18") — `_maybe_send_auto_reply`, called from `_fan_out_recipients`
for every TO/CC/BCC recipient of a `send_email` call, tested here through `send_email`
itself (same "test the public entry point the router actually calls" posture as
test_services_email.py) rather than by calling the private helper directly."""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy.orm import Session

from app import models
from app.schemas import EmailCreate
from app.services import email as email_service


def _enable_auto_reply(user: models.User, db: Session, *, start_offset=-1, end_offset=1, body="<p>בחופשה</p>"):
    user.auto_reply_enabled = True
    user.auto_reply_start = date.today() + timedelta(days=start_offset)
    user.auto_reply_end = date.today() + timedelta(days=end_offset)
    user.auto_reply_body = body
    db.commit()


def _auto_replies_to(db: Session, sender_id: int, recipient_id: int) -> list[models.Email]:
    return list(
        db.query(models.Email)
        .join(models.EmailRecipient, models.EmailRecipient.email_id == models.Email.email_id)
        .filter(
            models.Email.sender_id == sender_id,
            models.Email.status == "AUTO_REPLY",
            models.EmailRecipient.user_id == recipient_id,
        )
        .all()
    )


# ---------------------------------------------------------------------------
# Opt-in / default-behavior-unchanged
# ---------------------------------------------------------------------------


def test_normal_send_with_no_auto_responders_configured_is_unaffected(db: Session, make_user):
    """This is the "fully opt-in" guarantee (TODO_SPEC.md task 18's own ask): a
    plain send_email between two users with default (auto_reply_enabled=False,
    everything else NULL) settings behaves exactly as it did before this feature —
    same shape test_services_email.py's own baseline test already asserts."""
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")

    email = email_service.send_email(
        db, sender.user_id, EmailCreate(to=[recipient.user_id], subject="עדכון", body_html="<p>שלום</p>")
    )

    assert email.status == "SENT"
    all_emails = db.query(models.Email).all()
    assert len(all_emails) == 1  # no auto-reply generated
    recipients = db.query(models.EmailRecipient).filter_by(email_id=email.email_id).all()
    assert len(recipients) == 2  # recipient's INBOX copy + sender's SENT copy, nothing more


# ---------------------------------------------------------------------------
# Fires when in range / enabled
# ---------------------------------------------------------------------------


def test_auto_reply_fires_when_enabled_and_in_range(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    away_user = make_user(role="PROPERTY_MANAGER")
    _enable_auto_reply(away_user, db, body="<p>אני בחופשה עד סוף החודש</p>")

    email_service.send_email(
        db, sender.user_id, EmailCreate(to=[away_user.user_id], subject="שאלה דחופה", body_html="<p>שלום</p>")
    )

    replies = _auto_replies_to(db, away_user.user_id, sender.user_id)
    assert len(replies) == 1
    reply = replies[0]
    assert reply.subject == "Re: שאלה דחופה"
    assert "בחופשה" in reply.body_html
    assert reply.status == "AUTO_REPLY"

    # The reply actually lands in the sender's inbox.
    sender_copy = (
        db.query(models.EmailRecipient)
        .filter_by(email_id=reply.email_id, user_id=sender.user_id)
        .one()
    )
    assert sender_copy.folder == "INBOX"


def test_auto_reply_fires_for_cc_and_bcc_recipients_too(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    cc_away = make_user(role="PROPERTY_MANAGER")
    bcc_away = make_user(role="CFO")
    _enable_auto_reply(cc_away, db)
    _enable_auto_reply(bcc_away, db)

    email_service.send_email(
        db, sender.user_id,
        EmailCreate(to=[], cc=[cc_away.user_id], bcc=[bcc_away.user_id], subject="עדכון", body_html="<p>שלום</p>"),
    )

    assert len(_auto_replies_to(db, cc_away.user_id, sender.user_id)) == 1
    assert len(_auto_replies_to(db, bcc_away.user_id, sender.user_id)) == 1


# ---------------------------------------------------------------------------
# Does NOT fire when disabled / out of range
# ---------------------------------------------------------------------------


def test_auto_reply_does_not_fire_when_disabled(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    # auto_reply_enabled defaults to False even with dates set.
    recipient.auto_reply_start = date.today() - timedelta(days=1)
    recipient.auto_reply_end = date.today() + timedelta(days=1)
    recipient.auto_reply_body = "<p>בחופשה</p>"
    db.commit()

    email_service.send_email(
        db, sender.user_id, EmailCreate(to=[recipient.user_id], subject="עדכון", body_html="<p>שלום</p>")
    )

    assert _auto_replies_to(db, recipient.user_id, sender.user_id) == []


def test_auto_reply_does_not_fire_before_start_date(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    _enable_auto_reply(recipient, db, start_offset=5, end_offset=10)  # starts in the future

    email_service.send_email(
        db, sender.user_id, EmailCreate(to=[recipient.user_id], subject="עדכון", body_html="<p>שלום</p>")
    )

    assert _auto_replies_to(db, recipient.user_id, sender.user_id) == []


def test_auto_reply_does_not_fire_after_end_date(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    _enable_auto_reply(recipient, db, start_offset=-10, end_offset=-1)  # already ended

    email_service.send_email(
        db, sender.user_id, EmailCreate(to=[recipient.user_id], subject="עדכון", body_html="<p>שלום</p>")
    )

    assert _auto_replies_to(db, recipient.user_id, sender.user_id) == []


def test_auto_reply_does_not_fire_when_dates_missing(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    recipient.auto_reply_enabled = True  # enabled, but no range configured
    recipient.auto_reply_body = "<p>בחופשה</p>"
    db.commit()

    email_service.send_email(
        db, sender.user_id, EmailCreate(to=[recipient.user_id], subject="עדכון", body_html="<p>שלום</p>")
    )

    assert _auto_replies_to(db, recipient.user_id, sender.user_id) == []


# ---------------------------------------------------------------------------
# Loop prevention
# ---------------------------------------------------------------------------


def test_incoming_auto_reply_does_not_trigger_a_further_auto_reply(db: Session, make_user):
    """Both users have auto-responder on: A -> B triggers exactly one auto-reply
    (B -> A). That auto-reply must NOT itself trigger a further auto-reply back
    from A, even though A also has auto_reply_enabled=True and A is the recipient
    of B's reply."""
    user_a = make_user(role="RISK_MANAGER")
    user_b = make_user(role="PROPERTY_MANAGER")
    _enable_auto_reply(user_a, db, body="<p>גם אני בחופשה</p>")
    _enable_auto_reply(user_b, db, body="<p>בחופשה</p>")

    email_service.send_email(
        db, user_a.user_id, EmailCreate(to=[user_b.user_id], subject="שאלה", body_html="<p>שלום</p>")
    )

    # Exactly one auto-reply total: B -> A. None from A -> B.
    b_to_a = _auto_replies_to(db, user_b.user_id, user_a.user_id)
    a_to_b = _auto_replies_to(db, user_a.user_id, user_b.user_id)
    assert len(b_to_a) == 1
    assert len(a_to_b) == 0

    total_auto_replies = db.query(models.Email).filter_by(status="AUTO_REPLY").count()
    assert total_auto_replies == 1


def test_replying_to_an_existing_auto_reply_thread_does_not_cascade(db: Session, make_user):
    """A plain (non-auto) reply to an AUTO_REPLY-status email must still not
    trigger a further auto-reply if the *replier* is the one currently out of
    office — guard (a) keys off the message being replied to being an auto-reply,
    which the original away_user's own reply-to-yourself case aside, exercises the
    same status check from a different angle: manually constructing a
    status="AUTO_REPLY" email and sending through the normal fan-out path."""
    away_user = make_user(role="PROPERTY_MANAGER")
    other = make_user(role="RISK_MANAGER")
    _enable_auto_reply(away_user, db)

    # An AUTO_REPLY-status message from `other` to `away_user` (simulating a
    # message that is itself an auto-reply arriving in away_user's inbox).
    auto_reply_in = EmailCreate(to=[away_user.user_id], subject="Re: משהו", body_html="<p>תגובה אוטומטית</p>")
    email_service.send_email(db, other.user_id, auto_reply_in, status="AUTO_REPLY")

    # away_user must not have auto-replied back to `other` for this one.
    assert _auto_replies_to(db, away_user.user_id, other.user_id) == []


# ---------------------------------------------------------------------------
# Once-per-day-per-sender rate limiting
# ---------------------------------------------------------------------------


def test_auto_reply_rate_limited_to_once_per_day_per_sender(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    away_user = make_user(role="PROPERTY_MANAGER")
    _enable_auto_reply(away_user, db)

    email_service.send_email(
        db, sender.user_id, EmailCreate(to=[away_user.user_id], subject="הודעה 1", body_html="<p>1</p>")
    )
    email_service.send_email(
        db, sender.user_id, EmailCreate(to=[away_user.user_id], subject="הודעה 2", body_html="<p>2</p>")
    )

    # Two incoming messages the same day from the same sender -> still only one
    # auto-reply.
    replies = _auto_replies_to(db, away_user.user_id, sender.user_id)
    assert len(replies) == 1


def test_auto_reply_rate_limit_is_scoped_per_sender(db: Session, make_user):
    """The once-per-day limit is per (out-of-office user, sender) pair — a second,
    *different* sender on the same day still gets their own auto-reply."""
    sender_1 = make_user(role="RISK_MANAGER")
    sender_2 = make_user(role="CFO")
    away_user = make_user(role="PROPERTY_MANAGER")
    _enable_auto_reply(away_user, db)

    email_service.send_email(
        db, sender_1.user_id, EmailCreate(to=[away_user.user_id], subject="מ-1", body_html="<p>1</p>")
    )
    email_service.send_email(
        db, sender_2.user_id, EmailCreate(to=[away_user.user_id], subject="מ-2", body_html="<p>2</p>")
    )

    assert len(_auto_replies_to(db, away_user.user_id, sender_1.user_id)) == 1
    assert len(_auto_replies_to(db, away_user.user_id, sender_2.user_id)) == 1


def test_auto_reply_rate_limit_does_not_block_a_new_day(db: Session, make_user):
    """A previously-sent auto-reply from a prior day must not suppress today's —
    the rate limit query bounds by today's [start, end) window (see
    _has_auto_replied_today's docstring), so a hand-backdated existing AUTO_REPLY
    row from "yesterday" doesn't count against today's limit."""
    from datetime import datetime, timezone

    sender = make_user(role="RISK_MANAGER")
    away_user = make_user(role="PROPERTY_MANAGER")
    _enable_auto_reply(away_user, db)

    # Simulate an auto-reply already sent yesterday.
    yesterday_reply = models.Email(
        sender_id=away_user.user_id,
        subject="Re: אתמול",
        body_html="<p>בחופשה</p>",
        status="AUTO_REPLY",
        created_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1),
    )
    db.add(yesterday_reply)
    db.flush()
    db.add(models.EmailRecipient(
        email_id=yesterday_reply.email_id, user_id=sender.user_id, recipient_type="TO", folder="INBOX", is_read=False
    ))
    db.commit()

    email_service.send_email(
        db, sender.user_id, EmailCreate(to=[away_user.user_id], subject="היום", body_html="<p>היום</p>")
    )

    replies_today_and_before = _auto_replies_to(db, away_user.user_id, sender.user_id)
    # yesterday's simulated row + today's real one
    assert len(replies_today_and_before) == 2
