"""Integration tests for TODO_SPEC.md "משימה 16" (Custom Folders/Labels):
routers/labels.py's /api/folders CRUD, and routers/emails.py's
POST/DELETE /api/emails/{id}/tags[/...] + GET /api/emails's `label_id`
filter. Covers label CRUD, per-user privacy/scoping of labels, attach/detach
of a label to an email thread, filtering the mailbox by label, and that the
label filter composes with (rather than replaces) the existing folder/search
filters — see routers/emails.py's module docstring and
services/email.list_emails_for_user's docstring.
"""
from __future__ import annotations

from tests.conftest import auth_headers


def _send(client, headers, *, to, subject="נושא", body_html="<p>שלום</p>", in_reply_to=None):
    payload = {"to": to, "cc": [], "bcc": [], "subject": subject, "body_html": body_html}
    if in_reply_to is not None:
        payload["in_reply_to"] = in_reply_to
    return client.post("/api/emails", json=payload, headers=headers)


def _create_label(client, headers, *, name="דחוף", color="#e53935"):
    return client.post("/api/folders", json={"name": name, "color": color}, headers=headers)


# ---------------------------------------------------------------------------
# Label CRUD
# ---------------------------------------------------------------------------


def test_create_and_list_label(client, make_user):
    user = make_user(role="RISK_MANAGER")
    headers = auth_headers(user)

    resp = _create_label(client, headers, name="תביעות דחופות", color="#e53935")
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "תביעות דחופות"
    assert body["color"] == "#e53935"
    assert "id" in body

    list_resp = client.get("/api/folders", headers=headers)
    assert list_resp.status_code == 200
    names = [l["name"] for l in list_resp.json()]
    assert names == ["תביעות דחופות"]


def test_create_label_requires_auth(client):
    resp = client.post("/api/folders", json={"name": "x", "color": "#fff"})
    assert resp.status_code == 401


def test_list_labels_requires_auth(client):
    resp = client.get("/api/folders")
    assert resp.status_code == 401


def test_delete_label(client, make_user):
    user = make_user(role="RISK_MANAGER")
    headers = auth_headers(user)
    label_id = _create_label(client, headers).json()["id"]

    del_resp = client.delete(f"/api/folders/{label_id}", headers=headers)
    assert del_resp.status_code == 204

    list_resp = client.get("/api/folders", headers=headers)
    assert list_resp.json() == []


def test_delete_nonexistent_label_returns_404(client, make_user):
    user = make_user(role="RISK_MANAGER")
    resp = client.delete("/api/folders/999999", headers=auth_headers(user))
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Per-user privacy/scoping (TODO_SPEC.md step 1: "כדי שלכל משתמש יהיו תגיות משלו")
# ---------------------------------------------------------------------------


def test_labels_are_private_per_user(client, make_user):
    owner = make_user(role="RISK_MANAGER")
    other = make_user(role="CFO")
    label_id = _create_label(client, auth_headers(owner)).json()["id"]

    # The other user's own list never shows it.
    other_list = client.get("/api/folders", headers=auth_headers(other)).json()
    assert other_list == []

    # Two users can each independently create a same-named label.
    _create_label(client, auth_headers(other), name="דחוף", color="#000000")
    other_list_after = client.get("/api/folders", headers=auth_headers(other)).json()
    assert len(other_list_after) == 1


def test_delete_someone_elses_label_returns_404(client, make_user):
    owner = make_user(role="RISK_MANAGER")
    other = make_user(role="CFO")
    label_id = _create_label(client, auth_headers(owner)).json()["id"]

    resp = client.delete(f"/api/folders/{label_id}", headers=auth_headers(other))
    assert resp.status_code == 404

    # Still there for the actual owner.
    owner_list = client.get("/api/folders", headers=auth_headers(owner)).json()
    assert len(owner_list) == 1


# ---------------------------------------------------------------------------
# Attach / detach a label to an email thread
# ---------------------------------------------------------------------------


def test_attach_and_detach_label_to_email(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    recipient_headers = auth_headers(recipient)
    email_id = _send(client, auth_headers(sender), to=[recipient.user_id]).json()["email_id"]
    label_id = _create_label(client, recipient_headers).json()["id"]

    attach_resp = client.post(f"/api/emails/{email_id}/tags", json={"label_id": label_id}, headers=recipient_headers)
    assert attach_resp.status_code == 201, attach_resp.text
    body = attach_resp.json()
    assert body["email_id"] == email_id
    assert body["label"]["id"] == label_id

    thread = client.get(f"/api/emails/{email_id}", headers=recipient_headers).json()
    assert [l["id"] for l in thread["messages"][0]["labels"]] == [label_id]

    list_item = client.get("/api/emails", headers=recipient_headers).json()[0]
    assert [l["id"] for l in list_item["labels"]] == [label_id]

    detach_resp = client.delete(f"/api/emails/{email_id}/tags/{label_id}", headers=recipient_headers)
    assert detach_resp.status_code == 204

    thread_after = client.get(f"/api/emails/{email_id}", headers=recipient_headers).json()
    assert thread_after["messages"][0]["labels"] == []


def test_attach_label_is_idempotent(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    recipient_headers = auth_headers(recipient)
    email_id = _send(client, auth_headers(sender), to=[recipient.user_id]).json()["email_id"]
    label_id = _create_label(client, recipient_headers).json()["id"]

    resp1 = client.post(f"/api/emails/{email_id}/tags", json={"label_id": label_id}, headers=recipient_headers)
    resp2 = client.post(f"/api/emails/{email_id}/tags", json={"label_id": label_id}, headers=recipient_headers)
    assert resp1.status_code == 201
    assert resp2.status_code == 201
    assert resp1.json()["id"] == resp2.json()["id"]

    thread = client.get(f"/api/emails/{email_id}", headers=recipient_headers).json()
    assert len(thread["messages"][0]["labels"]) == 1


def test_detach_label_not_attached_is_a_noop(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    recipient_headers = auth_headers(recipient)
    email_id = _send(client, auth_headers(sender), to=[recipient.user_id]).json()["email_id"]
    label_id = _create_label(client, recipient_headers).json()["id"]

    resp = client.delete(f"/api/emails/{email_id}/tags/{label_id}", headers=recipient_headers)
    assert resp.status_code == 204


def test_attach_label_applies_to_whole_thread_via_root(client, make_user):
    """Tagging via a reply's own email_id tags the whole thread — the label
    shows up on every message and on the root, matching models.EmailLabel's
    thread-root design (see that model's docstring)."""
    user_a = make_user(role="RISK_MANAGER")
    user_b = make_user(role="PROPERTY_MANAGER")
    root_id = _send(client, auth_headers(user_a), to=[user_b.user_id], subject="שרשור").json()["email_id"]
    reply_id = _send(
        client, auth_headers(user_b), to=[user_a.user_id], subject="Re: שרשור", in_reply_to=root_id
    ).json()["email_id"]

    label_id = _create_label(client, auth_headers(user_a)).json()["id"]
    attach_resp = client.post(f"/api/emails/{reply_id}/tags", json={"label_id": label_id}, headers=auth_headers(user_a))
    assert attach_resp.status_code == 201
    assert attach_resp.json()["email_id"] == root_id  # always resolved to the thread root

    thread = client.get(f"/api/emails/{root_id}", headers=auth_headers(user_a)).json()
    assert all(l["id"] == label_id for m in thread["messages"] for l in m["labels"])
    assert [l["id"] for l in thread["root"]["labels"]] == [label_id]


def test_attach_label_requires_mailbox_ownership(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    bystander = make_user(role="CFO")
    email_id = _send(client, auth_headers(sender), to=[recipient.user_id]).json()["email_id"]
    label_id = _create_label(client, auth_headers(bystander)).json()["id"]

    resp = client.post(f"/api/emails/{email_id}/tags", json={"label_id": label_id}, headers=auth_headers(bystander))
    assert resp.status_code == 404


def test_attach_someone_elses_label_returns_404(client, make_user):
    """Even a caller who *can* see the email can't tag it with a label they
    don't own — labels are private per user (step 1)."""
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    email_id = _send(client, auth_headers(sender), to=[recipient.user_id]).json()["email_id"]
    other_label_id = _create_label(client, auth_headers(sender)).json()["id"]

    resp = client.post(
        f"/api/emails/{email_id}/tags", json={"label_id": other_label_id}, headers=auth_headers(recipient)
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Filtering GET /api/emails by label_id (composes with folder + q)
# ---------------------------------------------------------------------------


def test_list_emails_filters_by_label(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    recipient_headers = auth_headers(recipient)

    tagged_id = _send(client, auth_headers(sender), to=[recipient.user_id], subject="עם תגית").json()["email_id"]
    untagged_id = _send(client, auth_headers(sender), to=[recipient.user_id], subject="בלי תגית").json()["email_id"]
    label_id = _create_label(client, recipient_headers).json()["id"]
    client.post(f"/api/emails/{tagged_id}/tags", json={"label_id": label_id}, headers=recipient_headers)

    filtered = client.get("/api/emails", params={"label_id": label_id}, headers=recipient_headers).json()
    assert [e["email_id"] for e in filtered] == [tagged_id]

    unfiltered = client.get("/api/emails", headers=recipient_headers).json()
    assert {e["email_id"] for e in unfiltered} == {tagged_id, untagged_id}


def test_list_emails_label_filter_composes_with_folder(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    recipient_headers = auth_headers(recipient)

    email_id = _send(client, auth_headers(sender), to=[recipient.user_id], subject="ארכיון עם תגית").json()["email_id"]
    label_id = _create_label(client, recipient_headers).json()["id"]
    client.post(f"/api/emails/{email_id}/tags", json={"label_id": label_id}, headers=recipient_headers)

    # Still tagged, but not in ARCHIVE yet — folder+label must both match.
    archive_hit = client.get(
        "/api/emails", params={"folder": "ARCHIVE", "label_id": label_id}, headers=recipient_headers
    ).json()
    assert archive_hit == []
    inbox_hit = client.get(
        "/api/emails", params={"folder": "INBOX", "label_id": label_id}, headers=recipient_headers
    ).json()
    assert [e["email_id"] for e in inbox_hit] == [email_id]

    client.patch(f"/api/emails/{email_id}/folder", json={"folder": "ARCHIVE"}, headers=recipient_headers)
    archive_hit_after_move = client.get(
        "/api/emails", params={"folder": "ARCHIVE", "label_id": label_id}, headers=recipient_headers
    ).json()
    assert [e["email_id"] for e in archive_hit_after_move] == [email_id]


def test_list_emails_label_filter_composes_with_search(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    recipient_headers = auth_headers(recipient)

    match_id = _send(client, auth_headers(sender), to=[recipient.user_id], subject="עדכון תקציב").json()["email_id"]
    other_id = _send(client, auth_headers(sender), to=[recipient.user_id], subject="עדכון תקציב נוסף").json()["email_id"]
    label_id = _create_label(client, recipient_headers).json()["id"]
    client.post(f"/api/emails/{match_id}/tags", json={"label_id": label_id}, headers=recipient_headers)
    client.post(f"/api/emails/{other_id}/tags", json={"label_id": label_id}, headers=recipient_headers)

    resp = client.get(
        "/api/emails", params={"q": "תקציב", "label_id": label_id}, headers=recipient_headers
    ).json()
    assert {e["email_id"] for e in resp} == {match_id, other_id}

    narrower = client.get(
        "/api/emails", params={"q": "נוסף", "label_id": label_id}, headers=recipient_headers
    ).json()
    assert [e["email_id"] for e in narrower] == [other_id]


def test_list_emails_label_filter_requires_owned_label(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    other_label_id = _create_label(client, auth_headers(sender)).json()["id"]

    resp = client.get("/api/emails", params={"label_id": other_label_id}, headers=auth_headers(recipient))
    assert resp.status_code == 404


def test_list_emails_label_filter_scoped_to_own_mailbox(client, make_user):
    """A label filter can never surface someone else's mailbox contents — it
    narrows an already user-scoped query, same as `q` (Task 10)."""
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    bystander = make_user(role="CFO")
    email_id = _send(client, auth_headers(sender), to=[recipient.user_id]).json()["email_id"]
    recipient_label_id = _create_label(client, auth_headers(recipient)).json()["id"]
    client.post(f"/api/emails/{email_id}/tags", json={"label_id": recipient_label_id}, headers=auth_headers(recipient))

    bystander_label_id = _create_label(client, auth_headers(bystander)).json()["id"]
    resp = client.get(
        "/api/emails", params={"label_id": bystander_label_id}, headers=auth_headers(bystander)
    ).json()
    assert resp == []
