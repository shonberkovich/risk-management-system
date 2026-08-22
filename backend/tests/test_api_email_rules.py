"""Integration tests for TODO_SPEC.md "משימה 17" (Email Rules/Filters):
routers/email_rules.py's /api/rules CRUD, and the end-to-end wiring into
POST /api/emails (services/email.py's _fan_out_recipients calling
services/email_rules.evaluate_rules_for_recipient for every TO/CC/BCC
recipient)."""
from __future__ import annotations

from tests.conftest import auth_headers


def _send(client, headers, *, to, subject="נושא", body_html="<p>שלום</p>"):
    payload = {"to": to, "cc": [], "bcc": [], "subject": subject, "body_html": body_html}
    return client.post("/api/emails", json=payload, headers=headers)


def _create_rule(client, headers, *, name="כלל", conditions=None, actions=None, is_active=True):
    return client.post(
        "/api/rules",
        json={
            "name": name,
            "conditions": conditions or [{"field": "subject", "operator": "contains", "value": "דחוף"}],
            "actions": actions or [{"type": "mark_as_read"}],
            "is_active": is_active,
        },
        headers=headers,
    )


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


def test_create_and_list_rule(client, make_user):
    user = make_user(role="RISK_MANAGER")
    headers = auth_headers(user)

    resp = _create_rule(client, headers, name="תיוג דחוף")
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "תיוג דחוף"
    assert body["is_active"] is True
    assert body["conditions"] == [{"field": "subject", "operator": "contains", "value": "דחוף"}]
    assert body["actions"] == [{"type": "mark_as_read", "value": None}]

    list_resp = client.get("/api/rules", headers=headers)
    assert list_resp.status_code == 200
    assert [r["name"] for r in list_resp.json()] == ["תיוג דחוף"]


def test_create_rule_requires_auth(client):
    resp = client.post(
        "/api/rules",
        json={"name": "x", "conditions": [{"field": "subject", "operator": "contains", "value": "x"}],
              "actions": [{"type": "mark_as_read"}]},
    )
    assert resp.status_code == 401


def test_list_rules_requires_auth(client):
    assert client.get("/api/rules").status_code == 401


def test_create_rule_requires_at_least_one_condition(client, make_user):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    resp = client.post(
        "/api/rules",
        json={"name": "x", "conditions": [], "actions": [{"type": "mark_as_read"}]},
        headers=headers,
    )
    assert resp.status_code == 422


def test_create_rule_requires_at_least_one_action(client, make_user):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    resp = client.post(
        "/api/rules",
        json={"name": "x", "conditions": [{"field": "subject", "operator": "contains", "value": "x"}], "actions": []},
        headers=headers,
    )
    assert resp.status_code == 422


def test_delete_rule(client, make_user):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    rule_id = _create_rule(client, headers).json()["id"]

    del_resp = client.delete(f"/api/rules/{rule_id}", headers=headers)
    assert del_resp.status_code == 204
    assert client.get("/api/rules", headers=headers).json() == []


def test_delete_nonexistent_rule_returns_404(client, make_user):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    resp = client.delete("/api/rules/999999", headers=headers)
    assert resp.status_code == 404


def test_rules_are_private_per_user(client, make_user):
    owner = make_user(role="RISK_MANAGER")
    other = make_user(role="CFO")
    rule_id = _create_rule(client, auth_headers(owner)).json()["id"]

    assert client.get("/api/rules", headers=auth_headers(other)).json() == []

    del_resp = client.delete(f"/api/rules/{rule_id}", headers=auth_headers(other))
    assert del_resp.status_code == 404
    assert len(client.get("/api/rules", headers=auth_headers(owner)).json()) == 1


# ---------------------------------------------------------------------------
# End-to-end: sending mail runs it through the recipient's own rules
# ---------------------------------------------------------------------------


def test_send_email_rule_marks_as_read(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    headers = auth_headers(recipient)
    _create_rule(
        client, headers, name="סימון כנקרא",
        conditions=[{"field": "subject", "operator": "contains", "value": "עדכון"}],
        actions=[{"type": "mark_as_read"}],
    )

    _send(client, auth_headers(sender), to=[recipient.user_id], subject="עדכון סטטוס")

    inbox = client.get("/api/emails", headers=headers).json()
    assert len(inbox) == 1
    assert inbox[0]["is_read"] is True


def test_send_email_rule_moves_to_trash(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    headers = auth_headers(recipient)
    _create_rule(
        client, headers, name="אשפה לפרסומות",
        conditions=[{"field": "subject", "operator": "contains", "value": "פרסומת"}],
        actions=[{"type": "move_to_folder", "value": "TRASH"}],
    )

    resp = _send(client, auth_headers(sender), to=[recipient.user_id], subject="פרסומת מיוחדת עבורך")
    email_id = resp.json()["email_id"]

    assert client.get("/api/emails", headers=headers).json() == []
    trash = client.get("/api/emails", params={"folder": "TRASH"}, headers=headers).json()
    assert [e["email_id"] for e in trash] == [email_id]


def test_send_email_rule_adds_label(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    headers = auth_headers(recipient)
    label_id = client.post("/api/folders", json={"name": "דחוף", "color": "#e53935"}, headers=headers).json()["id"]
    _create_rule(
        client, headers, name="תיוג דחוף",
        conditions=[{"field": "subject", "operator": "contains", "value": "דחוף"}],
        actions=[{"type": "add_label", "value": str(label_id)}],
    )

    _send(client, auth_headers(sender), to=[recipient.user_id], subject="עדכון דחוף")

    inbox = client.get("/api/emails", headers=headers).json()
    assert [l["id"] for l in inbox[0]["labels"]] == [label_id]


def test_send_email_multiple_actions_on_one_rule(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    headers = auth_headers(recipient)
    label_id = client.post("/api/folders", json={"name": "חשוב", "color": "#000"}, headers=headers).json()["id"]
    _create_rule(
        client, headers, name="כלל משולב",
        conditions=[{"field": "subject", "operator": "contains", "value": "חשוב"}],
        actions=[{"type": "add_label", "value": str(label_id)}, {"type": "mark_as_read"}],
    )

    _send(client, auth_headers(sender), to=[recipient.user_id], subject="עדכון חשוב")

    inbox = client.get("/api/emails", headers=headers).json()
    assert inbox[0]["is_read"] is True
    assert [l["id"] for l in inbox[0]["labels"]] == [label_id]


def test_send_email_inactive_rule_does_not_fire(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    headers = auth_headers(recipient)
    _create_rule(
        client, headers, name="כבוי",
        conditions=[{"field": "subject", "operator": "contains", "value": "עדכון"}],
        actions=[{"type": "mark_as_read"}],
        is_active=False,
    )

    _send(client, auth_headers(sender), to=[recipient.user_id], subject="עדכון סטטוס")

    inbox = client.get("/api/emails", headers=headers).json()
    assert inbox[0]["is_read"] is False


def test_send_email_rule_does_not_fire_for_non_matching_subject(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    headers = auth_headers(recipient)
    _create_rule(
        client, headers, name="כלל",
        conditions=[{"field": "subject", "operator": "contains", "value": "דחוף"}],
        actions=[{"type": "mark_as_read"}],
    )

    _send(client, auth_headers(sender), to=[recipient.user_id], subject="עדכון רגיל")

    inbox = client.get("/api/emails", headers=headers).json()
    assert inbox[0]["is_read"] is False


def test_send_email_rules_scoped_per_recipient(client, make_user):
    """Recipient A's rule tagging their own copy must never affect recipient
    B's independent copy of the exact same email."""
    sender = make_user(role="RISK_MANAGER")
    recipient_a = make_user(role="PROPERTY_MANAGER")
    recipient_b = make_user(role="CFO")
    headers_a = auth_headers(recipient_a)
    headers_b = auth_headers(recipient_b)
    _create_rule(
        client, headers_a, name="רק אצלי",
        conditions=[{"field": "subject", "operator": "contains", "value": "עדכון"}],
        actions=[{"type": "mark_as_read"}],
    )

    _send(client, auth_headers(sender), to=[recipient_a.user_id, recipient_b.user_id], subject="עדכון סטטוס")

    inbox_a = client.get("/api/emails", headers=headers_a).json()
    inbox_b = client.get("/api/emails", headers=headers_b).json()
    assert inbox_a[0]["is_read"] is True
    assert inbox_b[0]["is_read"] is False


def test_send_email_rule_never_applies_to_senders_own_sent_copy(client, make_user):
    """A rule owned by the sender that would match their own outgoing subject
    must never touch the sender's own SENT-folder copy — rules only ever run
    against incoming TO/CC/BCC deliveries."""
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    sender_headers = auth_headers(sender)
    _create_rule(
        client, sender_headers, name="כלל של השולח",
        conditions=[{"field": "subject", "operator": "contains", "value": "עדכון"}],
        actions=[{"type": "move_to_folder", "value": "TRASH"}],
    )

    _send(client, sender_headers, to=[recipient.user_id], subject="עדכון סטטוס")

    sent = client.get("/api/emails", params={"folder": "SENT"}, headers=sender_headers).json()
    assert len(sent) == 1  # still in SENT, not moved to TRASH
