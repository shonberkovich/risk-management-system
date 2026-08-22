"""Tests for TODO_SPEC.md task 13's server-side half ("השהיית שליחה וביטול
שליחה" — scheduled send): services/email.py's schedule_email/
list_scheduled_emails_for_user/cancel_scheduled_email/
process_due_scheduled_emails, routers/emails.py's POST /schedule, GET
/scheduled, DELETE /cancel-schedule/{id}, and app/services/scheduler.py's
pytest-skip guard.

Client-side undo-send (the other half of this task) is pure frontend — see
frontend/src/components/EmailComposeModal.test.tsx.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.schemas import EmailScheduleCreate
from app.services import email as email_service
from tests.conftest import auth_headers


def _future(minutes: int = 10) -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=minutes)


def _past(minutes: int = 10) -> datetime:
    return datetime.now(timezone.utc) - timedelta(minutes=minutes)


# ---------------------------------------------------------------------------
# schemas.EmailScheduleCreate — future-datetime validation
# ---------------------------------------------------------------------------


def test_schedule_create_rejects_past_and_now():
    with pytest.raises(ValueError):
        EmailScheduleCreate(to=[1], subject="s", body_html="<p>b</p>", scheduled_for=_past())

    with pytest.raises(ValueError):
        EmailScheduleCreate(to=[1], subject="s", body_html="<p>b</p>", scheduled_for=datetime.now(timezone.utc))


def test_schedule_create_accepts_future():
    payload = EmailScheduleCreate(to=[1], subject="s", body_html="<p>b</p>", scheduled_for=_future())
    assert payload.scheduled_for > datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# services.email.schedule_email — creates the row, no Email_Recipients yet
# ---------------------------------------------------------------------------


def test_schedule_email_creates_row_with_no_recipients_yet(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    to_user = make_user(role="PROPERTY_MANAGER")
    cc_user = make_user(role="CFO")

    scheduled_for = _future()
    email_in = EmailScheduleCreate(
        to=[to_user.user_id], cc=[cc_user.user_id], subject="דוח רבעוני", body_html="<p>שלום</p>",
        scheduled_for=scheduled_for,
    )
    email = email_service.schedule_email(db, sender.user_id, email_in)

    assert email.email_id is not None
    assert email.status == "SCHEDULED"
    assert email.scheduled_for is not None
    # Stored naive-UTC, matching this repo's convention (see models._utcnow).
    assert email.scheduled_for.tzinfo is None

    # The whole point: no Email_Recipients rows exist yet for anyone, sender included.
    recipients = db.scalars(select(models.EmailRecipient).where(models.EmailRecipient.email_id == email.email_id)).all()
    assert recipients == []

    decoded = email_service.deserialize_scheduled_recipients(email.scheduled_recipients)
    assert decoded == {"to": [to_user.user_id], "cc": [cc_user.user_id], "bcc": []}


def test_list_scheduled_emails_for_user_scoped_to_sender(db: Session, make_user):
    sender_a = make_user(role="RISK_MANAGER")
    sender_b = make_user(role="RISK_MANAGER")
    to_user = make_user(role="PROPERTY_MANAGER")

    email_service.schedule_email(
        db, sender_a.user_id,
        EmailScheduleCreate(to=[to_user.user_id], subject="A", body_html="<p>a</p>", scheduled_for=_future()),
    )
    email_service.schedule_email(
        db, sender_b.user_id,
        EmailScheduleCreate(to=[to_user.user_id], subject="B", body_html="<p>b</p>", scheduled_for=_future()),
    )

    a_scheduled = email_service.list_scheduled_emails_for_user(db, sender_a.user_id)
    assert [e.subject for e in a_scheduled] == ["A"]

    b_scheduled = email_service.list_scheduled_emails_for_user(db, sender_b.user_id)
    assert [e.subject for e in b_scheduled] == ["B"]


# ---------------------------------------------------------------------------
# services.email.process_due_scheduled_emails — the testable "flip" logic,
# called directly with a fixed `now` instead of waiting on real wall-clock time.
# ---------------------------------------------------------------------------


def test_process_due_scheduled_emails_flips_status_and_fans_out(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    to_user = make_user(role="PROPERTY_MANAGER")
    bcc_user = make_user(role="CFO")

    scheduled_for = _future(minutes=5)
    email = email_service.schedule_email(
        db, sender.user_id,
        EmailScheduleCreate(
            to=[to_user.user_id], bcc=[bcc_user.user_id], subject="דוח", body_html="<p>x</p>",
            scheduled_for=scheduled_for,
        ),
    )

    # Not due yet at a "now" before scheduled_for.
    not_yet = email_service.process_due_scheduled_emails(db, now=scheduled_for.replace(tzinfo=None) - timedelta(minutes=1))
    assert not_yet == []
    db.refresh(email)
    assert email.status == "SCHEDULED"

    # Due once "now" is at/after scheduled_for — simulated instantly, no real sleep.
    processed = email_service.process_due_scheduled_emails(db, now=scheduled_for.replace(tzinfo=None) + timedelta(seconds=1))
    assert [e.email_id for e in processed] == [email.email_id]

    db.refresh(email)
    assert email.status == "SENT"

    recipients = db.scalars(select(models.EmailRecipient).where(models.EmailRecipient.email_id == email.email_id)).all()
    by_user = {r.user_id: r for r in recipients}
    assert by_user[to_user.user_id].recipient_type == "TO"
    assert by_user[to_user.user_id].folder == "INBOX"
    assert by_user[bcc_user.user_id].recipient_type == "BCC"
    assert by_user[sender.user_id].folder == "SENT"
    assert by_user[sender.user_id].is_read is True

    # A second poll tick must not re-process an already-SENT email (no duplicate rows).
    again = email_service.process_due_scheduled_emails(db, now=scheduled_for.replace(tzinfo=None) + timedelta(hours=1))
    assert again == []
    recipients_after = db.scalars(select(models.EmailRecipient).where(models.EmailRecipient.email_id == email.email_id)).all()
    assert len(recipients_after) == len(recipients)


def test_process_due_scheduled_emails_broadcasts_sse(db: Session, make_user, monkeypatch):
    from app.services import sse_manager

    sender = make_user(role="RISK_MANAGER")
    to_user = make_user(role="PROPERTY_MANAGER")

    scheduled_for = _future(minutes=1)
    email_service.schedule_email(
        db, sender.user_id,
        EmailScheduleCreate(to=[to_user.user_id], subject="נשלח", body_html="<p>x</p>", scheduled_for=scheduled_for),
    )

    queue = sse_manager.connect(to_user.user_id)
    try:
        email_service.process_due_scheduled_emails(db, now=scheduled_for.replace(tzinfo=None) + timedelta(seconds=1))
        assert queue.qsize() == 1
        event = queue.get_nowait()
        assert event["type"] == "new_email"
        assert event["subject"] == "נשלח"
    finally:
        sse_manager.disconnect(to_user.user_id, queue)


# ---------------------------------------------------------------------------
# services.email.cancel_scheduled_email
# ---------------------------------------------------------------------------


def test_cancel_scheduled_email_deletes_row(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    to_user = make_user(role="PROPERTY_MANAGER")
    email = email_service.schedule_email(
        db, sender.user_id,
        EmailScheduleCreate(to=[to_user.user_id], subject="x", body_html="<p>x</p>", scheduled_for=_future()),
    )

    email_service.cancel_scheduled_email(db, email.email_id, sender.user_id)

    assert db.get(models.Email, email.email_id) is None


def test_cancel_scheduled_email_not_sender_raises(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    other = make_user(role="CFO")
    to_user = make_user(role="PROPERTY_MANAGER")
    email = email_service.schedule_email(
        db, sender.user_id,
        EmailScheduleCreate(to=[to_user.user_id], subject="x", body_html="<p>x</p>", scheduled_for=_future()),
    )

    with pytest.raises(ValueError, match="not found"):
        email_service.cancel_scheduled_email(db, email.email_id, other.user_id)


def test_cancel_scheduled_email_after_it_sent_raises(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    to_user = make_user(role="PROPERTY_MANAGER")
    scheduled_for = _future(minutes=1)
    email = email_service.schedule_email(
        db, sender.user_id,
        EmailScheduleCreate(to=[to_user.user_id], subject="x", body_html="<p>x</p>", scheduled_for=scheduled_for),
    )
    email_service.process_due_scheduled_emails(db, now=scheduled_for.replace(tzinfo=None) + timedelta(seconds=1))

    with pytest.raises(ValueError, match="not cancellable"):
        email_service.cancel_scheduled_email(db, email.email_id, sender.user_id)


def test_cancel_scheduled_email_after_scheduled_for_passed_raises(db: Session, make_user):
    """Even if the poller hasn't ticked yet, an email whose scheduled_for has
    already passed is no longer safely cancellable (it's about to send)."""
    sender = make_user(role="RISK_MANAGER")
    to_user = make_user(role="PROPERTY_MANAGER")
    email = email_service.schedule_email(
        db, sender.user_id,
        EmailScheduleCreate(to=[to_user.user_id], subject="x", body_html="<p>x</p>", scheduled_for=_future(minutes=1)),
    )
    # Simulate time having passed without the poller having ticked yet.
    email.scheduled_for = _past().replace(tzinfo=None)
    db.commit()

    with pytest.raises(ValueError, match="not cancellable"):
        email_service.cancel_scheduled_email(db, email.email_id, sender.user_id)


def test_cancel_nonexistent_email_raises(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    with pytest.raises(ValueError, match="not found"):
        email_service.cancel_scheduled_email(db, 999_999, sender.user_id)


# ---------------------------------------------------------------------------
# API layer — POST /api/emails/schedule, GET /api/emails/scheduled,
# DELETE /api/emails/cancel-schedule/{id}
# ---------------------------------------------------------------------------


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def test_api_schedule_email_creates_and_is_invisible_to_recipient(client, db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    to_user = make_user(role="PROPERTY_MANAGER")
    scheduled_for = _future(minutes=15)

    resp = client.post(
        "/api/emails/schedule",
        json={
            "to": [to_user.user_id], "subject": "עדכון עתידי", "body_html": "<p>שלום</p>",
            "scheduled_for": _iso(scheduled_for),
        },
        headers=auth_headers(sender),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "SCHEDULED"
    assert body["to"][0]["user_id"] == to_user.user_id
    email_id = body["email_id"]

    # Not visible to the recipient's inbox yet.
    inbox = client.get("/api/emails", headers=auth_headers(to_user)).json()
    assert inbox == []

    # Nor is it individually fetchable by the recipient (no Email_Recipients row yet).
    get_resp = client.get(f"/api/emails/{email_id}", headers=auth_headers(to_user))
    assert get_resp.status_code == 404

    # Once the poller processes it (simulated directly, no real wait)...
    email_service.process_due_scheduled_emails(db, now=scheduled_for.replace(tzinfo=None) + timedelta(seconds=1))

    inbox_after = client.get("/api/emails", headers=auth_headers(to_user)).json()
    assert [e["subject"] for e in inbox_after] == ["עדכון עתידי"]
    assert client.get(f"/api/emails/{email_id}", headers=auth_headers(to_user)).status_code == 200


def test_api_schedule_email_rejects_past_datetime(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    to_user = make_user(role="PROPERTY_MANAGER")

    resp = client.post(
        "/api/emails/schedule",
        json={"to": [to_user.user_id], "subject": "x", "body_html": "<p>x</p>", "scheduled_for": _iso(_past())},
        headers=auth_headers(sender),
    )
    assert resp.status_code == 422


def test_api_schedule_email_rejects_unknown_recipient(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    resp = client.post(
        "/api/emails/schedule",
        json={"to": [999_999], "subject": "x", "body_html": "<p>x</p>", "scheduled_for": _iso(_future())},
        headers=auth_headers(sender),
    )
    assert resp.status_code == 404


def test_api_schedule_email_requires_auth(client, make_user):
    to_user = make_user(role="PROPERTY_MANAGER")
    resp = client.post(
        "/api/emails/schedule",
        json={"to": [to_user.user_id], "subject": "x", "body_html": "<p>x</p>", "scheduled_for": _iso(_future())},
    )
    assert resp.status_code == 401


def test_api_list_scheduled_emails_scoped_to_current_user(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    other_sender = make_user(role="CFO")
    to_user = make_user(role="PROPERTY_MANAGER")

    client.post(
        "/api/emails/schedule",
        json={"to": [to_user.user_id], "subject": "שלי", "body_html": "<p>x</p>", "scheduled_for": _iso(_future())},
        headers=auth_headers(sender),
    )
    client.post(
        "/api/emails/schedule",
        json={"to": [to_user.user_id], "subject": "לא שלי", "body_html": "<p>x</p>", "scheduled_for": _iso(_future())},
        headers=auth_headers(other_sender),
    )

    mine = client.get("/api/emails/scheduled", headers=auth_headers(sender)).json()
    assert [e["subject"] for e in mine] == ["שלי"]


def test_api_cancel_schedule_deletes_and_removes_from_list(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    to_user = make_user(role="PROPERTY_MANAGER")
    create_resp = client.post(
        "/api/emails/schedule",
        json={"to": [to_user.user_id], "subject": "לביטול", "body_html": "<p>x</p>", "scheduled_for": _iso(_future())},
        headers=auth_headers(sender),
    )
    email_id = create_resp.json()["email_id"]

    cancel_resp = client.delete(f"/api/emails/cancel-schedule/{email_id}", headers=auth_headers(sender))
    assert cancel_resp.status_code == 204

    assert client.get("/api/emails/scheduled", headers=auth_headers(sender)).json() == []


def test_api_cancel_schedule_not_sender_returns_404(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    bystander = make_user(role="CFO")
    to_user = make_user(role="PROPERTY_MANAGER")
    create_resp = client.post(
        "/api/emails/schedule",
        json={"to": [to_user.user_id], "subject": "x", "body_html": "<p>x</p>", "scheduled_for": _iso(_future())},
        headers=auth_headers(sender),
    )
    email_id = create_resp.json()["email_id"]

    resp = client.delete(f"/api/emails/cancel-schedule/{email_id}", headers=auth_headers(bystander))
    assert resp.status_code == 404


def test_api_cancel_schedule_nonexistent_returns_404(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    resp = client.delete("/api/emails/cancel-schedule/999999", headers=auth_headers(sender))
    assert resp.status_code == 404


def test_api_cancel_schedule_after_sent_returns_409(client, db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    to_user = make_user(role="PROPERTY_MANAGER")
    scheduled_for = _future(minutes=1)
    create_resp = client.post(
        "/api/emails/schedule",
        json={
            "to": [to_user.user_id], "subject": "x", "body_html": "<p>x</p>",
            "scheduled_for": _iso(scheduled_for),
        },
        headers=auth_headers(sender),
    )
    email_id = create_resp.json()["email_id"]

    email_service.process_due_scheduled_emails(db, now=scheduled_for.replace(tzinfo=None) + timedelta(seconds=1))

    resp = client.delete(f"/api/emails/cancel-schedule/{email_id}", headers=auth_headers(sender))
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# app/services/scheduler.py — the poller is never started under pytest
# ---------------------------------------------------------------------------


def test_scheduler_skips_starting_under_pytest():
    from app.services import scheduler

    assert scheduler._running_under_pytest() is True
    assert scheduler.start_scheduled_email_poller() is None
