"""Unit tests for app/services/email_rules.py (TODO_SPEC.md "משימה 17") —
rule CRUD plus, most importantly, `evaluate_rules_for_recipient`'s matching/
apply logic tested directly against a plain Session, with no HTTP layer and
no `send_email` call at all (per this task's own "must be a pure, easily-
testable function" requirement)."""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app import models, schemas
from app.services import email as email_service
from app.services import email_rules as email_rules_service


def _make_email(db: Session, sender: models.User, subject: str, body_html: str = "<p>גוף ההודעה</p>") -> models.Email:
    email = models.Email(sender_id=sender.user_id, subject=subject, body_html=body_html, status="SENT")
    db.add(email)
    db.commit()
    db.refresh(email)
    return email


def _make_recipient_row(db: Session, email: models.Email, user: models.User) -> models.EmailRecipient:
    row = models.EmailRecipient(
        email_id=email.email_id, user_id=user.user_id, recipient_type="TO", folder="INBOX", is_read=False
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _condition(field: str, operator: str, value: str) -> schemas.EmailRuleCondition:
    return schemas.EmailRuleCondition(field=field, operator=operator, value=value)


def _action(type_: str, value: str | None = None) -> schemas.EmailRuleAction:
    return schemas.EmailRuleAction(type=type_, value=value)


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


def test_create_and_list_rule(db: Session, make_user):
    owner = make_user(role="RISK_MANAGER")
    rule = email_rules_service.create_rule(
        db, owner.user_id, "כלל בדיקה",
        conditions=[_condition("subject", "contains", "דחוף")],
        actions=[_action("mark_as_read")],
    )
    assert rule.id is not None
    assert rule.is_active is True

    rules = email_rules_service.list_rules_for_user(db, owner.user_id)
    assert [r.id for r in rules] == [rule.id]

    out = email_rules_service.to_email_rule_out(rule)
    assert out.conditions == [_condition("subject", "contains", "דחוף")]
    assert out.actions == [_action("mark_as_read")]


def test_list_rules_scoped_per_user(db: Session, make_user):
    owner = make_user(role="RISK_MANAGER")
    other = make_user(role="CFO")
    email_rules_service.create_rule(
        db, owner.user_id, "שלי", conditions=[_condition("subject", "contains", "x")], actions=[_action("mark_as_read")]
    )
    assert email_rules_service.list_rules_for_user(db, other.user_id) == []


def test_delete_rule(db: Session, make_user):
    owner = make_user(role="RISK_MANAGER")
    rule = email_rules_service.create_rule(
        db, owner.user_id, "למחיקה", conditions=[_condition("subject", "contains", "x")], actions=[_action("mark_as_read")]
    )
    email_rules_service.delete_rule(db, rule.id, owner.user_id)
    assert email_rules_service.list_rules_for_user(db, owner.user_id) == []


def test_delete_someone_elses_rule_raises(db: Session, make_user):
    owner = make_user(role="RISK_MANAGER")
    other = make_user(role="CFO")
    rule = email_rules_service.create_rule(
        db, owner.user_id, "לא לך", conditions=[_condition("subject", "contains", "x")], actions=[_action("mark_as_read")]
    )
    try:
        email_rules_service.delete_rule(db, rule.id, other.user_id)
        assert False, "expected ValueError"
    except ValueError:
        pass
    assert len(email_rules_service.list_rules_for_user(db, owner.user_id)) == 1


# ---------------------------------------------------------------------------
# evaluate_rules_for_recipient — matching + applying actions
# ---------------------------------------------------------------------------


def test_no_active_rules_is_a_noop(db: Session, make_user):
    owner = make_user(role="RISK_MANAGER")
    sender = make_user(role="PROPERTY_MANAGER")
    email = _make_email(db, sender, subject="כלשהו")
    row = _make_recipient_row(db, email, owner)

    email_rules_service.evaluate_rules_for_recipient(db, owner.user_id, email, row)

    assert row.folder == "INBOX"
    assert row.is_read is False


def test_subject_contains_triggers_add_label(db: Session, make_user):
    owner = make_user(role="RISK_MANAGER")
    sender = make_user(role="PROPERTY_MANAGER")
    label = email_service.create_label(db, owner.user_id, "דחוף", "#e53935")
    email_rules_service.create_rule(
        db, owner.user_id, "תיוג דחוף",
        conditions=[_condition("subject", "contains", "דחוף")],
        actions=[_action("add_label", str(label.id))],
    )
    email = _make_email(db, sender, subject="עדכון דחוף בנושא התביעה")
    row = _make_recipient_row(db, email, owner)

    email_rules_service.evaluate_rules_for_recipient(db, owner.user_id, email, row)
    db.commit()

    tags = db.query(models.EmailLabel).filter_by(email_id=email.email_id, label_id=label.id).all()
    assert len(tags) == 1


def test_matching_is_case_insensitive(db: Session, make_user):
    owner = make_user(role="RISK_MANAGER")
    sender = make_user(role="PROPERTY_MANAGER")
    email_rules_service.create_rule(
        db, owner.user_id, "כלל", conditions=[_condition("subject", "contains", "URGENT")], actions=[_action("mark_as_read")]
    )
    email = _make_email(db, sender, subject="This is Urgent news")
    row = _make_recipient_row(db, email, owner)

    email_rules_service.evaluate_rules_for_recipient(db, owner.user_id, email, row)

    assert row.is_read is True


def test_sender_equals_triggers_move_to_trash(db: Session, make_user):
    owner = make_user(role="RISK_MANAGER")
    spammer = make_user(role="PROPERTY_MANAGER", email="spam@example.com")
    email_rules_service.create_rule(
        db, owner.user_id, "אשפה לספאם",
        conditions=[_condition("sender", "equals", "spam@example.com")],
        actions=[_action("move_to_folder", "TRASH")],
    )
    email = _make_email(db, spammer, subject="מבצע מיוחד")
    row = _make_recipient_row(db, email, owner)

    email_rules_service.evaluate_rules_for_recipient(db, owner.user_id, email, row)

    assert row.folder == "TRASH"


def test_body_contains_triggers_mark_as_read(db: Session, make_user):
    owner = make_user(role="RISK_MANAGER")
    sender = make_user(role="PROPERTY_MANAGER")
    email_rules_service.create_rule(
        db, owner.user_id, "כלל גוף", conditions=[_condition("body", "contains", "אישור")], actions=[_action("mark_as_read")]
    )
    email = _make_email(db, sender, subject="נושא", body_html="<p>נדרש אישור מנהל</p>")
    row = _make_recipient_row(db, email, owner)

    email_rules_service.evaluate_rules_for_recipient(db, owner.user_id, email, row)

    assert row.is_read is True


def test_multiple_conditions_are_anded(db: Session, make_user):
    owner = make_user(role="RISK_MANAGER")
    boss = make_user(role="CFO", email="boss@example.com")
    stranger = make_user(role="PROPERTY_MANAGER", email="other@example.com")
    email_rules_service.create_rule(
        db, owner.user_id, "כלל AND",
        conditions=[
            _condition("subject", "contains", "תקציב"),
            _condition("sender", "equals", "boss@example.com"),
        ],
        actions=[_action("mark_as_read")],
    )

    # Subject matches but sender doesn't -> the rule must not fire.
    email_partial = _make_email(db, stranger, subject="עדכון תקציב")
    row_partial = _make_recipient_row(db, email_partial, owner)
    email_rules_service.evaluate_rules_for_recipient(db, owner.user_id, email_partial, row_partial)
    assert row_partial.is_read is False

    # Both conditions match -> fires.
    email_full = _make_email(db, boss, subject="עדכון תקציב")
    row_full = _make_recipient_row(db, email_full, owner)
    email_rules_service.evaluate_rules_for_recipient(db, owner.user_id, email_full, row_full)
    assert row_full.is_read is True


def test_multiple_rules_apply_cumulatively(db: Session, make_user):
    owner = make_user(role="RISK_MANAGER")
    sender = make_user(role="PROPERTY_MANAGER")
    label = email_service.create_label(db, owner.user_id, "חשוב", "#000000")
    email_rules_service.create_rule(
        db, owner.user_id, "תיוג", conditions=[_condition("subject", "contains", "עדכון")],
        actions=[_action("add_label", str(label.id))],
    )
    email_rules_service.create_rule(
        db, owner.user_id, "סימון כנקרא", conditions=[_condition("subject", "contains", "עדכון")],
        actions=[_action("mark_as_read")],
    )
    email = _make_email(db, sender, subject="עדכון סטטוס")
    row = _make_recipient_row(db, email, owner)

    email_rules_service.evaluate_rules_for_recipient(db, owner.user_id, email, row)
    db.commit()

    assert row.is_read is True
    assert db.query(models.EmailLabel).filter_by(email_id=email.email_id, label_id=label.id).count() == 1


def test_inactive_rule_is_skipped(db: Session, make_user):
    owner = make_user(role="RISK_MANAGER")
    sender = make_user(role="PROPERTY_MANAGER")
    email_rules_service.create_rule(
        db, owner.user_id, "כבוי", conditions=[_condition("subject", "contains", "x")],
        actions=[_action("mark_as_read")], is_active=False,
    )
    email = _make_email(db, sender, subject="x")
    row = _make_recipient_row(db, email, owner)

    email_rules_service.evaluate_rules_for_recipient(db, owner.user_id, email, row)

    assert row.is_read is False


def test_rules_are_scoped_per_user_not_cross_applied(db: Session, make_user):
    """Two recipients of the *same* email: only the recipient who owns a
    matching rule is affected — the other recipient's copy of the identical
    message is untouched."""
    user_a = make_user(role="RISK_MANAGER")
    user_b = make_user(role="CFO")
    sender = make_user(role="PROPERTY_MANAGER")
    email_rules_service.create_rule(
        db, user_a.user_id, "רק לי", conditions=[_condition("subject", "contains", "עדכון")],
        actions=[_action("mark_as_read")],
    )
    email = _make_email(db, sender, subject="עדכון סטטוס")
    row_a = _make_recipient_row(db, email, user_a)
    row_b = _make_recipient_row(db, email, user_b)

    email_rules_service.evaluate_rules_for_recipient(db, user_a.user_id, email, row_a)
    email_rules_service.evaluate_rules_for_recipient(db, user_b.user_id, email, row_b)

    assert row_a.is_read is True
    assert row_b.is_read is False


def test_add_label_skips_if_label_not_owned_by_rule_owner(db: Session, make_user):
    owner = make_user(role="RISK_MANAGER")
    other = make_user(role="CFO")
    sender = make_user(role="PROPERTY_MANAGER")
    other_label = email_service.create_label(db, other.user_id, "של מישהו אחר", "#000000")
    email_rules_service.create_rule(
        db, owner.user_id, "כלל", conditions=[_condition("subject", "contains", "x")],
        actions=[_action("add_label", str(other_label.id))],
    )
    email = _make_email(db, sender, subject="x")
    row = _make_recipient_row(db, email, owner)

    email_rules_service.evaluate_rules_for_recipient(db, owner.user_id, email, row)
    db.commit()

    assert db.query(models.EmailLabel).filter_by(label_id=other_label.id).count() == 0


def test_add_label_is_idempotent_across_multiple_matching_rules(db: Session, make_user):
    owner = make_user(role="RISK_MANAGER")
    sender = make_user(role="PROPERTY_MANAGER")
    label = email_service.create_label(db, owner.user_id, "תג", "#000000")
    email_rules_service.create_rule(
        db, owner.user_id, "כלל 1", conditions=[_condition("subject", "contains", "x")],
        actions=[_action("add_label", str(label.id))],
    )
    email_rules_service.create_rule(
        db, owner.user_id, "כלל 2", conditions=[_condition("subject", "contains", "x")],
        actions=[_action("add_label", str(label.id))],
    )
    email = _make_email(db, sender, subject="x")
    row = _make_recipient_row(db, email, owner)

    email_rules_service.evaluate_rules_for_recipient(db, owner.user_id, email, row)
    db.commit()

    assert db.query(models.EmailLabel).filter_by(email_id=email.email_id, label_id=label.id).count() == 1


def test_move_to_folder_ignores_unrecognized_folder_value(db: Session, make_user):
    owner = make_user(role="RISK_MANAGER")
    sender = make_user(role="PROPERTY_MANAGER")
    rule = email_rules_service.create_rule(
        db, owner.user_id, "כלל", conditions=[_condition("subject", "contains", "x")],
        actions=[_action("mark_as_read")],
    )
    # Hand-corrupt the stored actions to simulate a stale/invalid folder value
    # bypassing schema validation — the engine must fail safe, not raise.
    rule.actions = json.dumps([{"type": "move_to_folder", "value": "NOT_A_REAL_FOLDER"}])
    db.commit()
    email = _make_email(db, sender, subject="x")
    row = _make_recipient_row(db, email, owner)

    email_rules_service.evaluate_rules_for_recipient(db, owner.user_id, email, row)

    assert row.folder == "INBOX"


def test_unknown_condition_field_never_matches(db: Session, make_user):
    owner = make_user(role="RISK_MANAGER")
    sender = make_user(role="PROPERTY_MANAGER")
    rule = email_rules_service.create_rule(
        db, owner.user_id, "כלל שגוי", conditions=[_condition("subject", "contains", "x")],
        actions=[_action("mark_as_read")],
    )
    rule.conditions = json.dumps([{"field": "cc", "operator": "contains", "value": "x"}])
    db.commit()
    email = _make_email(db, sender, subject="x")
    row = _make_recipient_row(db, email, owner)

    email_rules_service.evaluate_rules_for_recipient(db, owner.user_id, email, row)

    assert row.is_read is False
