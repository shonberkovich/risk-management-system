"""Integration tests for routers/emails.py (TODO_SPEC.md "משימה 5") — the REST
API surface over services/email.py. Covers send + retrieval, folder listing +
pagination, mark-as-read/move-to-folder persistence, the always-EmailThreadOut
shape of GET /{id} (single message vs. real thread), and the "not yours" 404
scoping (a user with no Email_Recipients row for an email can't GET/read/
move it — see routers/emails.py's module docstring for why 404 rather than
403).
"""
from __future__ import annotations

from tests.conftest import auth_headers


def _send(client, headers, *, to, cc=None, bcc=None, subject="נושא", body_html="<p>שלום</p>", in_reply_to=None):
    payload = {
        "to": to,
        "cc": cc or [],
        "bcc": bcc or [],
        "subject": subject,
        "body_html": body_html,
    }
    if in_reply_to is not None:
        payload["in_reply_to"] = in_reply_to
    return client.post("/api/emails", json=payload, headers=headers)


# ---------------------------------------------------------------------------
# Send + retrieve
# ---------------------------------------------------------------------------


def test_send_email_creates_recipients_and_is_retrievable(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    to_user = make_user(role="PROPERTY_MANAGER")
    cc_user = make_user(role="CFO")
    sender_headers = auth_headers(sender)

    resp = _send(client, sender_headers, to=[to_user.user_id], cc=[cc_user.user_id], subject="בדיקה", body_html="<p>גוף</p>")
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["subject"] == "בדיקה"
    assert body["sender"]["user_id"] == sender.user_id
    assert body["thread_id"] is None
    recipient_ids = {r["user"]["user_id"]: r for r in body["recipients"]}
    assert recipient_ids[to_user.user_id]["recipient_type"] == "TO"
    assert recipient_ids[to_user.user_id]["folder"] == "INBOX"
    assert recipient_ids[cc_user.user_id]["recipient_type"] == "CC"
    assert recipient_ids[sender.user_id]["folder"] == "SENT"
    email_id = body["email_id"]

    # Retrievable by the recipient as a (single-message) thread.
    to_headers = auth_headers(to_user)
    get_resp = client.get(f"/api/emails/{email_id}", headers=to_headers)
    assert get_resp.status_code == 200
    thread = get_resp.json()
    assert thread["root"]["email_id"] == email_id
    assert [m["email_id"] for m in thread["messages"]] == [email_id]

    # And by the sender too (their SENT copy).
    sender_get = client.get(f"/api/emails/{email_id}", headers=sender_headers)
    assert sender_get.status_code == 200


def test_send_email_requires_auth(client, make_user):
    to_user = make_user(role="PROPERTY_MANAGER")
    resp = _send(client, {}, to=[to_user.user_id])
    assert resp.status_code == 401


def test_send_email_rejects_unknown_recipient(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    resp = _send(client, auth_headers(sender), to=[999_999])
    assert resp.status_code == 404


def test_send_email_rejects_unknown_in_reply_to(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    other = make_user(role="PROPERTY_MANAGER")
    resp = _send(client, auth_headers(sender), to=[other.user_id], in_reply_to=999_999)
    assert resp.status_code == 404


def test_thread_reply_returns_full_thread_to_participants(client, make_user):
    user_a = make_user(role="RISK_MANAGER")
    user_b = make_user(role="PROPERTY_MANAGER")

    root_resp = _send(client, auth_headers(user_a), to=[user_b.user_id], subject="שרשור", body_html="<p>1</p>")
    root_id = root_resp.json()["email_id"]

    reply_resp = _send(
        client, auth_headers(user_b), to=[user_a.user_id], subject="Re: שרשור", body_html="<p>2</p>", in_reply_to=root_id
    )
    assert reply_resp.status_code == 201
    reply_id = reply_resp.json()["email_id"]

    thread = client.get(f"/api/emails/{root_id}", headers=auth_headers(user_a)).json()
    assert thread["root"]["email_id"] == root_id
    assert [m["email_id"] for m in thread["messages"]] == [root_id, reply_id]

    # Fetching by the reply's own id resolves to the same thread.
    thread_via_reply = client.get(f"/api/emails/{reply_id}", headers=auth_headers(user_b)).json()
    assert thread_via_reply["root"]["email_id"] == root_id
    assert [m["email_id"] for m in thread_via_reply["messages"]] == [root_id, reply_id]


# ---------------------------------------------------------------------------
# "Not yours" scoping
# ---------------------------------------------------------------------------


def test_get_email_not_yours_returns_404(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    to_user = make_user(role="PROPERTY_MANAGER")
    bystander = make_user(role="CFO")
    email_id = _send(client, auth_headers(sender), to=[to_user.user_id]).json()["email_id"]

    resp = client.get(f"/api/emails/{email_id}", headers=auth_headers(bystander))
    assert resp.status_code == 404


def test_mark_read_not_yours_returns_404(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    to_user = make_user(role="PROPERTY_MANAGER")
    bystander = make_user(role="CFO")
    email_id = _send(client, auth_headers(sender), to=[to_user.user_id]).json()["email_id"]

    resp = client.patch(f"/api/emails/{email_id}/read", json={"is_read": True}, headers=auth_headers(bystander))
    assert resp.status_code == 404


def test_move_folder_not_yours_returns_404(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    to_user = make_user(role="PROPERTY_MANAGER")
    bystander = make_user(role="CFO")
    email_id = _send(client, auth_headers(sender), to=[to_user.user_id]).json()["email_id"]

    resp = client.patch(f"/api/emails/{email_id}/folder", json={"folder": "ARCHIVE"}, headers=auth_headers(bystander))
    assert resp.status_code == 404


def test_get_nonexistent_email_returns_404(client, make_user):
    user = make_user(role="RISK_MANAGER")
    resp = client.get("/api/emails/999999", headers=auth_headers(user))
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Folder listing + pagination
# ---------------------------------------------------------------------------


def test_list_emails_defaults_to_inbox_and_paginates(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    sender_headers = auth_headers(sender)
    recipient_headers = auth_headers(recipient)

    for i in range(3):
        _send(client, sender_headers, to=[recipient.user_id], subject=f"msg {i}", body_html="x")

    inbox_resp = client.get("/api/emails", headers=recipient_headers)
    assert inbox_resp.status_code == 200
    inbox = inbox_resp.json()
    assert len(inbox) == 3
    assert all(item["folder"] == "INBOX" for item in inbox)
    assert all(item["is_read"] is False for item in inbox)

    sent_resp = client.get("/api/emails", params={"folder": "SENT"}, headers=sender_headers)
    assert len(sent_resp.json()) == 3

    archive_resp = client.get("/api/emails", params={"folder": "ARCHIVE"}, headers=recipient_headers)
    assert archive_resp.json() == []

    page1 = client.get("/api/emails", params={"skip": 0, "limit": 2}, headers=recipient_headers).json()
    page2 = client.get("/api/emails", params={"skip": 2, "limit": 2}, headers=recipient_headers).json()
    assert len(page1) == 2
    assert len(page2) == 1
    assert {i["email_id"] for i in page1}.isdisjoint({i["email_id"] for i in page2})


def test_list_emails_requires_auth(client):
    resp = client.get("/api/emails")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Mark-as-read / move-to-folder persistence
# ---------------------------------------------------------------------------


def test_mark_as_read_persists(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    recipient_headers = auth_headers(recipient)
    email_id = _send(client, auth_headers(sender), to=[recipient.user_id]).json()["email_id"]

    resp = client.patch(f"/api/emails/{email_id}/read", json={"is_read": True}, headers=recipient_headers)
    assert resp.status_code == 200
    assert resp.json()["is_read"] is True

    inbox = client.get("/api/emails", headers=recipient_headers).json()
    assert inbox[0]["is_read"] is True

    # Setting back to unread also persists.
    resp2 = client.patch(f"/api/emails/{email_id}/read", json={"is_read": False}, headers=recipient_headers)
    assert resp2.json()["is_read"] is False


def test_move_to_folder_persists(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    recipient_headers = auth_headers(recipient)
    email_id = _send(client, auth_headers(sender), to=[recipient.user_id]).json()["email_id"]

    resp = client.patch(f"/api/emails/{email_id}/folder", json={"folder": "ARCHIVE"}, headers=recipient_headers)
    assert resp.status_code == 200
    assert resp.json()["folder"] == "ARCHIVE"

    inbox = client.get("/api/emails", headers=recipient_headers).json()
    assert inbox == []
    archive = client.get("/api/emails", params={"folder": "ARCHIVE"}, headers=recipient_headers).json()
    assert len(archive) == 1
    assert archive[0]["email_id"] == email_id

    # The email itself is still individually retrievable after moving folders.
    get_resp = client.get(f"/api/emails/{email_id}", headers=recipient_headers)
    assert get_resp.status_code == 200
