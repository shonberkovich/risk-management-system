"""Integration tests for Task 6 ("משימה 6": email attachments) — POST
/api/emails/{id}/attachments and GET /api/emails/attachments/{id}/signed-url,
layered on top of Task 5's routers/emails.py. STORAGE_ROOT is monkeypatched to
a pytest tmp_path for every test, same isolation convention as
test_api_media.py, so nothing here touches the real (gitignored)
backend/media_storage/ directory.
"""
from __future__ import annotations

import io

import pytest

from app import models
from app.services import storage
from tests.conftest import auth_headers


@pytest.fixture(autouse=True)
def _isolated_storage_root(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "STORAGE_ROOT", tmp_path)


def _send(client, headers, *, to, cc=None, bcc=None, subject="נושא", body_html="<p>שלום</p>"):
    payload = {"to": to, "cc": cc or [], "bcc": bcc or [], "subject": subject, "body_html": body_html}
    resp = client.post("/api/emails", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["email_id"]


def _attach(client, headers, email_id, files):
    """files: list of (field_name, filename, content, content_type) tuples."""
    return client.post(
        f"/api/emails/{email_id}/attachments",
        files=[("files", (name, io.BytesIO(content), ctype)) for _, name, content, ctype in files],
        headers=headers,
    )


# ---------------------------------------------------------------------------
# Send with zero attachments still works (additive-only feature)
# ---------------------------------------------------------------------------


def test_send_email_without_attachments_still_works(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    email_id = _send(client, auth_headers(sender), to=[recipient.user_id])

    get_resp = client.get(f"/api/emails/{email_id}", headers=auth_headers(recipient))
    assert get_resp.status_code == 200
    assert get_resp.json()["messages"][0]["attachments"] == []


# ---------------------------------------------------------------------------
# Upload creates EmailAttachment rows, retrievable via email/thread GET
# ---------------------------------------------------------------------------


def test_add_attachments_creates_rows_and_retrievable_via_thread(client, make_user, tmp_path):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    sender_headers = auth_headers(sender)
    email_id = _send(client, sender_headers, to=[recipient.user_id])

    resp = _attach(
        client,
        sender_headers,
        email_id,
        [
            ("files", "report.pdf", b"%PDF-1.4 fake pdf bytes", "application/pdf"),
            ("files", "photo.jpg", b"\xff\xd8\xff fake jpeg bytes", "image/jpeg"),
        ],
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert len(body) == 2
    names = {a["file_name"] for a in body}
    assert names == {"report.pdf", "photo.jpg"}
    for a in body:
        assert a["file_size"] > 0
        assert "id" in a and "content_type" in a

    # Physically persisted under media_storage/emails/<email_id>/...
    assert (tmp_path / "emails" / str(email_id) / "report.pdf").exists()

    # Retrievable via GET /api/emails/{id} (EmailThreadOut -> EmailOut.attachments)
    # both for the sender and for a recipient.
    for headers in (sender_headers, auth_headers(recipient)):
        thread = client.get(f"/api/emails/{email_id}", headers=headers).json()
        msg = thread["messages"][0]
        assert {a["file_name"] for a in msg["attachments"]} == {"report.pdf", "photo.jpg"}


def test_add_attachments_requires_auth(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    email_id = _send(client, auth_headers(sender), to=[sender.user_id])
    resp = client.post(
        f"/api/emails/{email_id}/attachments",
        files=[("files", ("a.pdf", io.BytesIO(b"x"), "application/pdf"))],
    )
    assert resp.status_code == 401


def test_add_attachments_rejects_non_sender(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    bystander = make_user(role="CFO")
    email_id = _send(client, auth_headers(sender), to=[recipient.user_id])

    # Even a legitimate recipient may not attach files to someone else's email.
    resp = _attach(client, auth_headers(recipient), email_id, [("files", "a.pdf", b"x", "application/pdf")])
    assert resp.status_code == 404

    resp2 = _attach(client, auth_headers(bystander), email_id, [("files", "a.pdf", b"x", "application/pdf")])
    assert resp2.status_code == 404


def test_add_attachments_to_nonexistent_email_returns_404(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    resp = _attach(client, auth_headers(sender), 999999, [("files", "a.pdf", b"x", "application/pdf")])
    assert resp.status_code == 404


def test_add_attachments_rejects_oversized_file(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    email_id = _send(client, auth_headers(sender), to=[sender.user_id])
    oversized = b"0" * (25 * 1024 * 1024 + 1)
    resp = _attach(client, auth_headers(sender), email_id, [("files", "big.pdf", oversized, "application/pdf")])
    assert resp.status_code == 400
    assert "חורג" in resp.json()["detail"]


def test_add_attachments_rejects_empty_file(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    email_id = _send(client, auth_headers(sender), to=[sender.user_id])
    resp = _attach(client, auth_headers(sender), email_id, [("files", "empty.pdf", b"", "application/pdf")])
    assert resp.status_code == 400
    assert "ריק" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Signed URL authorization
# ---------------------------------------------------------------------------


def test_signed_url_works_for_sender_and_recipient(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    sender_headers = auth_headers(sender)
    email_id = _send(client, sender_headers, to=[recipient.user_id])
    content = b"%PDF-1.4 attachment bytes"
    attachment_id = _attach(
        client, sender_headers, email_id, [("files", "doc.pdf", content, "application/pdf")]
    ).json()[0]["id"]

    for headers in (sender_headers, auth_headers(recipient)):
        resp = client.get(f"/api/emails/attachments/{attachment_id}/signed-url", headers=headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "download_url" in body and body["storage_key"]

        download = client.get(body["download_url"])
        assert download.status_code == 200
        assert download.content == content


def test_signed_url_404s_for_unrelated_user(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    bystander = make_user(role="CFO")
    sender_headers = auth_headers(sender)
    email_id = _send(client, sender_headers, to=[recipient.user_id])
    attachment_id = _attach(
        client, sender_headers, email_id, [("files", "doc.pdf", b"x", "application/pdf")]
    ).json()[0]["id"]

    resp = client.get(f"/api/emails/attachments/{attachment_id}/signed-url", headers=auth_headers(bystander))
    assert resp.status_code == 404


def test_signed_url_for_nonexistent_attachment_returns_404(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    resp = client.get("/api/emails/attachments/999999/signed-url", headers=auth_headers(sender))
    assert resp.status_code == 404


def test_signed_url_404_message_does_not_distinguish_nonexistent_from_not_yours(client, make_user):
    """Task 10 RBAC-audit fix (see routers/emails.py's module docstring): a
    nonexistent attachment_id and an existing-but-not-yours attachment_id used to
    come back with two different 404 messages, letting a caller enumerate valid
    attachment_ids by message text alone. Both cases must now be identical."""
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    bystander = make_user(role="CFO")
    sender_headers = auth_headers(sender)
    email_id = _send(client, sender_headers, to=[recipient.user_id])
    attachment_id = _attach(
        client, sender_headers, email_id, [("files", "doc.pdf", b"x", "application/pdf")]
    ).json()[0]["id"]

    not_yours = client.get(f"/api/emails/attachments/{attachment_id}/signed-url", headers=auth_headers(bystander))
    nonexistent = client.get("/api/emails/attachments/999999/signed-url", headers=auth_headers(bystander))

    assert not_yours.status_code == nonexistent.status_code == 404
    assert not_yours.json()["detail"] == nonexistent.json()["detail"] == "Attachment not found"


def test_signed_url_requires_auth(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    email_id = _send(client, auth_headers(sender), to=[sender.user_id])
    attachment_id = _attach(
        client, auth_headers(sender), email_id, [("files", "doc.pdf", b"x", "application/pdf")]
    ).json()[0]["id"]

    resp = client.get(f"/api/emails/attachments/{attachment_id}/signed-url")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# TODO_SPEC.md "משימה 20" step 1 — signed-url downloads are audited despite
# being a GET (see app/middleware/audit.py's module docstring for the
# named-GET-route mechanism).
# ---------------------------------------------------------------------------


def test_signed_url_download_writes_an_audit_log_row(client, make_user, db):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    sender_headers = auth_headers(sender)
    email_id = _send(client, sender_headers, to=[recipient.user_id])
    attachment_id = _attach(
        client, sender_headers, email_id, [("files", "doc.pdf", b"x", "application/pdf")]
    ).json()[0]["id"]

    before = db.query(models.AuditLog).count()
    resp = client.get(f"/api/emails/attachments/{attachment_id}/signed-url", headers=sender_headers)
    assert resp.status_code == 200

    rows = db.query(models.AuditLog).order_by(models.AuditLog.log_id.desc()).all()
    assert len(rows) == before + 1
    row = rows[0]
    assert row.entity_type == "EMAIL_ATTACHMENT"
    assert row.entity_id == attachment_id
    assert row.action == "DOWNLOAD"
    assert row.user_id == sender.user_id
    # Metadata only (TODO_SPEC.md step 5) — no email/attachment content is ever
    # logged, just who/what/when.
    assert row.new_value is None
    assert row.old_value is None


def test_signed_url_download_audit_row_visible_via_admin_audit_log_api(client, make_user):
    admin = make_user(role="ADMIN")
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    sender_headers = auth_headers(sender)
    email_id = _send(client, sender_headers, to=[recipient.user_id])
    attachment_id = _attach(
        client, sender_headers, email_id, [("files", "doc.pdf", b"x", "application/pdf")]
    ).json()[0]["id"]

    client.get(f"/api/emails/attachments/{attachment_id}/signed-url", headers=sender_headers)

    resp = client.get("/api/audit-log", params={"entity_type": "EMAIL_ATTACHMENT"}, headers=auth_headers(admin))
    assert resp.status_code == 200
    entries = resp.json()["entries"]
    assert any(e["entity_id"] == attachment_id and e["action"] == "DOWNLOAD" for e in entries)


def test_other_gets_still_not_audited(client, make_user, db):
    """The named-GET-route allowlist (module docstring) is a narrow exception —
    an ordinary GET like listing emails must still never write an audit row."""
    sender = make_user(role="RISK_MANAGER")
    _send(client, auth_headers(sender), to=[sender.user_id])

    before = db.query(models.AuditLog).count()
    resp = client.get("/api/emails", headers=auth_headers(sender))
    assert resp.status_code == 200
    after = db.query(models.AuditLog).count()
    assert after == before
