"""Integration tests for TODO_SPEC.md "משימה 11" (Contextual Linking):
POST /api/emails/{id}/link and GET /api/{incidents|claims|properties}/{id}/emails.

Covers link creation (sender and recipient can link, a bystander cannot),
entity-existence validation, entity_type validation, thread-root resolution
(linking via a reply's id still links the whole thread, found under the
root's email_id), idempotency, per-viewer mailbox scoping on retrieval, and
the optional subject-line auto-detection (step 5).
"""
from __future__ import annotations

from tests.conftest import auth_headers


def _send(client, headers, *, to, cc=None, subject="נושא", body_html="<p>שלום</p>", in_reply_to=None):
    payload = {
        "to": to,
        "cc": cc or [],
        "bcc": [],
        "subject": subject,
        "body_html": body_html,
    }
    if in_reply_to is not None:
        payload["in_reply_to"] = in_reply_to
    resp = client.post("/api/emails", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _link(client, headers, email_id, entity_type, entity_id):
    return client.post(
        f"/api/emails/{email_id}/link",
        json={"entity_type": entity_type, "entity_id": entity_id},
        headers=headers,
    )


# ---------------------------------------------------------------------------
# POST /api/emails/{id}/link
# ---------------------------------------------------------------------------


def test_sender_can_link_email_to_property(client, make_user, make_property):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    prop = make_property()

    email = _send(client, auth_headers(sender), to=[recipient.user_id])
    resp = _link(client, auth_headers(sender), email["email_id"], "PROPERTY", prop.property_id)

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["entity_type"] == "PROPERTY"
    assert body["entity_id"] == prop.property_id
    assert body["email_id"] == email["email_id"]
    assert body["linked_by"] == sender.user_id
    assert body["auto_linked"] is False


def test_recipient_can_also_link_email(client, make_user, make_property):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    prop = make_property()

    email = _send(client, auth_headers(sender), to=[recipient.user_id])
    resp = _link(client, auth_headers(recipient), email["email_id"], "PROPERTY", prop.property_id)
    assert resp.status_code == 201


def test_bystander_cannot_link_email_gets_404(client, make_user, make_property):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    bystander = make_user(role="CFO")
    prop = make_property()

    email = _send(client, auth_headers(sender), to=[recipient.user_id])
    resp = _link(client, auth_headers(bystander), email["email_id"], "PROPERTY", prop.property_id)
    assert resp.status_code == 404


def test_link_requires_auth(client, make_user, make_property):
    sender = make_user(role="RISK_MANAGER")
    prop = make_property()
    email = _send(client, auth_headers(sender), to=[sender.user_id])
    resp = _link(client, {}, email["email_id"], "PROPERTY", prop.property_id)
    assert resp.status_code == 401


def test_link_rejects_nonexistent_entity_id(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    email = _send(client, auth_headers(sender), to=[sender.user_id])
    resp = _link(client, auth_headers(sender), email["email_id"], "PROPERTY", 999_999)
    assert resp.status_code == 404


def test_link_rejects_invalid_entity_type(client, make_user, make_property):
    sender = make_user(role="RISK_MANAGER")
    prop = make_property()
    email = _send(client, auth_headers(sender), to=[sender.user_id])
    resp = client.post(
        f"/api/emails/{email['email_id']}/link",
        json={"entity_type": "POLICY", "entity_id": prop.property_id},
        headers=auth_headers(sender),
    )
    assert resp.status_code == 422


def test_link_on_nonexistent_email_returns_404(client, make_user, make_property):
    sender = make_user(role="RISK_MANAGER")
    prop = make_property()
    resp = _link(client, auth_headers(sender), 999_999, "PROPERTY", prop.property_id)
    assert resp.status_code == 404


def test_linking_a_reply_links_the_whole_thread_under_its_root(client, make_user, make_property):
    """The spec says "link a thread", not a single message — linking via a
    reply's email_id must resolve to the thread root (see
    models.EntityEmail's docstring), so the link is discoverable by the
    root's own email_id, not the reply's."""
    user_a = make_user(role="RISK_MANAGER")
    user_b = make_user(role="PROPERTY_MANAGER")
    prop = make_property()

    root = _send(client, auth_headers(user_a), to=[user_b.user_id], subject="שרשור")
    reply = _send(
        client, auth_headers(user_b), to=[user_a.user_id], subject="Re: שרשור", in_reply_to=root["email_id"]
    )

    resp = _link(client, auth_headers(user_b), reply["email_id"], "PROPERTY", prop.property_id)
    assert resp.status_code == 201
    assert resp.json()["email_id"] == root["email_id"]

    linked = client.get(f"/api/properties/{prop.property_id}/emails", headers=auth_headers(user_a)).json()
    assert len(linked) == 1
    assert linked[0]["email_id"] == root["email_id"]


def test_relinking_same_thread_entity_is_idempotent(client, make_user, make_property):
    sender = make_user(role="RISK_MANAGER")
    prop = make_property()
    email = _send(client, auth_headers(sender), to=[sender.user_id])

    first = _link(client, auth_headers(sender), email["email_id"], "PROPERTY", prop.property_id)
    second = _link(client, auth_headers(sender), email["email_id"], "PROPERTY", prop.property_id)
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]

    linked = client.get(f"/api/properties/{prop.property_id}/emails", headers=auth_headers(sender)).json()
    assert len(linked) == 1


# ---------------------------------------------------------------------------
# GET /api/{incidents|claims|properties}/{id}/emails
# ---------------------------------------------------------------------------


def test_list_incident_emails_returns_linked_thread(client, make_user, make_property, make_incident):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    prop = make_property()
    incident = make_incident(prop.property_id)

    email = _send(client, auth_headers(sender), to=[recipient.user_id], subject="עדכון אירוע")
    _link(client, auth_headers(sender), email["email_id"], "INCIDENT", incident.incident_id)

    resp = client.get(f"/api/incidents/{incident.incident_id}/emails", headers=auth_headers(recipient))
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["email_id"] == email["email_id"]
    assert body[0]["subject"] == "עדכון אירוע"
    assert body[0]["auto_linked"] is False
    assert body[0]["linked_by"]["user_id"] == sender.user_id


def test_list_claim_emails_returns_linked_thread(client, make_user, make_property, make_incident, make_policy, make_claim):
    sender = make_user(role="RISK_MANAGER")
    prop = make_property()
    incident = make_incident(prop.property_id)
    policy = make_policy()
    claim = make_claim(incident.incident_id, policy.policy_id)

    email = _send(client, auth_headers(sender), to=[sender.user_id], subject="תביעה")
    _link(client, auth_headers(sender), email["email_id"], "CLAIM", claim.claim_id)

    resp = client.get(f"/api/claims/{claim.claim_id}/emails", headers=auth_headers(sender))
    assert resp.status_code == 200
    assert [e["email_id"] for e in resp.json()] == [email["email_id"]]


def test_list_emails_for_nonexistent_entity_returns_404(client, make_user):
    user = make_user(role="RISK_MANAGER")
    assert client.get("/api/incidents/999999/emails", headers=auth_headers(user)).status_code == 404
    assert client.get("/api/claims/999999/emails", headers=auth_headers(user)).status_code == 404
    assert client.get("/api/properties/999999/emails", headers=auth_headers(user)).status_code == 404


def test_list_entity_emails_requires_auth(client, make_property):
    prop = make_property()
    resp = client.get(f"/api/properties/{prop.property_id}/emails")
    assert resp.status_code == 401


def test_list_entity_emails_scoped_to_viewer_mailbox(client, make_user, make_property):
    """A linked thread must never surface to a viewer with no Email_Recipients
    row for it — entity linking must not become a way to bypass mailbox
    privacy (mirrors Task 5/10's own "not yours" scoping)."""
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    bystander = make_user(role="CFO")
    prop = make_property()

    email = _send(client, auth_headers(sender), to=[recipient.user_id])
    _link(client, auth_headers(sender), email["email_id"], "PROPERTY", prop.property_id)

    visible_to_recipient = client.get(f"/api/properties/{prop.property_id}/emails", headers=auth_headers(recipient)).json()
    assert len(visible_to_recipient) == 1

    visible_to_bystander = client.get(f"/api/properties/{prop.property_id}/emails", headers=auth_headers(bystander)).json()
    assert visible_to_bystander == []


def test_list_entity_emails_visible_to_reply_only_participant(client, make_user, make_property):
    """A viewer added only on a later reply (not the original root message)
    still counts as a thread participant — see
    services/email.list_linked_threads_for_entity's docstring."""
    user_a = make_user(role="RISK_MANAGER")
    user_b = make_user(role="PROPERTY_MANAGER")
    late_joiner = make_user(role="CFO")
    prop = make_property()

    root = _send(client, auth_headers(user_a), to=[user_b.user_id], subject="שרשור")
    _send(
        client, auth_headers(user_b), to=[user_a.user_id, late_joiner.user_id],
        subject="Re: שרשור", in_reply_to=root["email_id"],
    )
    _link(client, auth_headers(user_a), root["email_id"], "PROPERTY", prop.property_id)

    visible = client.get(f"/api/properties/{prop.property_id}/emails", headers=auth_headers(late_joiner)).json()
    assert len(visible) == 1
    assert visible[0]["email_id"] == root["email_id"]


# ---------------------------------------------------------------------------
# Auto-detection (Task 11 step 5, optional)
# ---------------------------------------------------------------------------


def test_autodetect_links_incident_code_in_subject(client, make_user, make_property, make_incident):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    prop = make_property()
    incident = make_incident(prop.property_id, incident_code="INC-2026-004")

    email = _send(client, auth_headers(sender), to=[recipient.user_id], subject="עדכון לגבי INC-2026-004")
    assert email["email_id"]

    linked = client.get(f"/api/incidents/{incident.incident_id}/emails", headers=auth_headers(sender)).json()
    assert len(linked) == 1
    assert linked[0]["email_id"] == email["email_id"]
    assert linked[0]["auto_linked"] is True
    assert linked[0]["linked_by"]["user_id"] == sender.user_id


def test_autodetect_links_property_code_in_subject(client, make_user, make_property):
    sender = make_user(role="RISK_MANAGER")
    prop = make_property(property_code="PRP-042")

    email = _send(client, auth_headers(sender), to=[sender.user_id], subject="בדיקה לנכס PRP-042 בבקשה")

    linked = client.get(f"/api/properties/{prop.property_id}/emails", headers=auth_headers(sender)).json()
    assert len(linked) == 1
    assert linked[0]["email_id"] == email["email_id"]
    assert linked[0]["auto_linked"] is True


def test_autodetect_ignores_unmatched_or_unknown_code(client, make_user, make_property):
    sender = make_user(role="RISK_MANAGER")
    prop = make_property()

    # No code-shaped token at all, and a code-shaped token that doesn't
    # resolve to any real row — neither should error or create a link.
    _send(client, auth_headers(sender), to=[sender.user_id], subject="פגישה רגילה מחר")
    _send(client, auth_headers(sender), to=[sender.user_id], subject="לגבי INC-2099-999 שלא קיים")

    linked = client.get(f"/api/properties/{prop.property_id}/emails", headers=auth_headers(sender)).json()
    assert linked == []
