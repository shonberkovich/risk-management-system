"""Unit tests for app/services/email.py (TODO_SPEC.md "משימה 3")."""
from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app import models
from app.schemas import EmailCreate
from app.services import email as email_service


def test_send_email_creates_recipients_with_right_types_and_folders(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    to_user = make_user(role="PROPERTY_MANAGER")
    cc_user = make_user(role="PROPERTY_MANAGER")
    bcc_user = make_user(role="CFO")

    email_in = EmailCreate(
        to=[to_user.user_id],
        cc=[cc_user.user_id],
        bcc=[bcc_user.user_id],
        subject="נושא בדיקה",
        body_html="<p>שלום</p>",
    )

    email = email_service.send_email(db, sender.user_id, email_in)

    assert email.email_id is not None
    assert email.sender_id == sender.user_id
    assert email.subject == "נושא בדיקה"
    assert email.status == "SENT"
    assert email.thread_id is None  # not a reply -> fresh thread, root has thread_id NULL

    recipients = db.query(models.EmailRecipient).filter_by(email_id=email.email_id).all()
    by_user = {r.user_id: r for r in recipients}

    assert by_user[to_user.user_id].recipient_type == "TO"
    assert by_user[to_user.user_id].folder == "INBOX"
    assert by_user[to_user.user_id].is_read is False

    assert by_user[cc_user.user_id].recipient_type == "CC"
    assert by_user[cc_user.user_id].folder == "INBOX"
    assert by_user[cc_user.user_id].is_read is False

    assert by_user[bcc_user.user_id].recipient_type == "BCC"
    assert by_user[bcc_user.user_id].folder == "INBOX"
    assert by_user[bcc_user.user_id].is_read is False


def test_send_email_gives_sender_a_read_sent_copy(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    to_user = make_user(role="PROPERTY_MANAGER")

    email_in = EmailCreate(to=[to_user.user_id], subject="נושא", body_html="<p>גוף</p>")
    email = email_service.send_email(db, sender.user_id, email_in)

    sender_copy = (
        db.query(models.EmailRecipient)
        .filter_by(email_id=email.email_id, user_id=sender.user_id)
        .one()
    )
    assert sender_copy.folder == "SENT"
    assert sender_copy.is_read is True

    # exactly two recipient rows total: the addressee's INBOX copy + the sender's SENT copy
    all_rows = db.query(models.EmailRecipient).filter_by(email_id=email.email_id).all()
    assert len(all_rows) == 2


def test_reply_resolves_thread_id_to_root(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    other = make_user(role="PROPERTY_MANAGER")

    root = email_service.send_email(
        db, sender.user_id, EmailCreate(to=[other.user_id], subject="שרשור", body_html="<p>1</p>")
    )
    assert root.thread_id is None

    reply = email_service.send_email(
        db,
        other.user_id,
        EmailCreate(
            to=[sender.user_id], subject="Re: שרשור", body_html="<p>2</p>", in_reply_to=root.email_id
        ),
    )

    assert reply.thread_id == root.email_id


def test_reply_to_a_reply_resolves_to_original_root(db: Session, make_user):
    """Replying to a reply must still land on the thread's original root, not on
    the intermediate reply's own email_id — the key case the flat self-FK
    scheme (models.Email docstring) exists to make cheap."""
    user_a = make_user(role="RISK_MANAGER")
    user_b = make_user(role="PROPERTY_MANAGER")
    user_c = make_user(role="CFO")

    root = email_service.send_email(
        db, user_a.user_id, EmailCreate(to=[user_b.user_id], subject="שרשור", body_html="<p>1</p>")
    )
    reply1 = email_service.send_email(
        db,
        user_b.user_id,
        EmailCreate(to=[user_a.user_id], subject="Re: שרשור", body_html="<p>2</p>", in_reply_to=root.email_id),
    )
    reply2 = email_service.send_email(
        db,
        user_c.user_id,
        EmailCreate(
            to=[user_a.user_id, user_b.user_id],
            subject="Re: שרשור",
            body_html="<p>3</p>",
            in_reply_to=reply1.email_id,  # reply to the reply, not the root
        ),
    )

    assert reply1.thread_id == root.email_id
    assert reply2.thread_id == root.email_id  # resolved through reply1 to the same root

    thread = email_service.get_thread(db, root.email_id)
    assert [e.email_id for e in thread] == [root.email_id, reply1.email_id, reply2.email_id]


def test_send_email_with_unknown_in_reply_to_raises(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    other = make_user(role="PROPERTY_MANAGER")

    with pytest.raises(ValueError):
        email_service.send_email(
            db,
            sender.user_id,
            EmailCreate(to=[other.user_id], subject="x", body_html="x", in_reply_to=999999),
        )


def test_mark_as_read(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    email = email_service.send_email(
        db, sender.user_id, EmailCreate(to=[recipient.user_id], subject="x", body_html="x")
    )

    row = email_service.mark_as_read(db, email.email_id, recipient.user_id, True)
    assert row.is_read is True

    row_again = email_service.mark_as_read(db, email.email_id, recipient.user_id, False)
    assert row_again.is_read is False


def test_mark_as_read_unknown_recipient_raises(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    bystander = make_user(role="CFO")
    email = email_service.send_email(
        db, sender.user_id, EmailCreate(to=[recipient.user_id], subject="x", body_html="x")
    )

    with pytest.raises(ValueError):
        email_service.mark_as_read(db, email.email_id, bystander.user_id, True)


def test_move_to_folder_and_archive_trash_wrappers(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    email = email_service.send_email(
        db, sender.user_id, EmailCreate(to=[recipient.user_id], subject="x", body_html="x")
    )

    row = email_service.move_to_folder(db, email.email_id, recipient.user_id, "ARCHIVE")
    assert row.folder == "ARCHIVE"

    row = email_service.trash_email(db, email.email_id, recipient.user_id)
    assert row.folder == "TRASH"

    row = email_service.archive_email(db, email.email_id, recipient.user_id)
    assert row.folder == "ARCHIVE"


def test_list_emails_for_user_is_folder_scoped_and_paginated(db: Session, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")

    for i in range(3):
        email_service.send_email(
            db, sender.user_id, EmailCreate(to=[recipient.user_id], subject=f"msg {i}", body_html="x")
        )

    inbox = email_service.list_emails_for_user(db, recipient.user_id, "INBOX")
    assert len(inbox) == 3
    assert all(r.folder == "INBOX" for r in inbox)

    sent = email_service.list_emails_for_user(db, sender.user_id, "SENT")
    assert len(sent) == 3

    archive = email_service.list_emails_for_user(db, recipient.user_id, "ARCHIVE")
    assert archive == []

    page1 = email_service.list_emails_for_user(db, recipient.user_id, "INBOX", skip=0, limit=2)
    page2 = email_service.list_emails_for_user(db, recipient.user_id, "INBOX", skip=2, limit=2)
    assert len(page1) == 2
    assert len(page2) == 1
    assert {r.id for r in page1}.isdisjoint({r.id for r in page2})
