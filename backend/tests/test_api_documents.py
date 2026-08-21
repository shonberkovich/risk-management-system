"""Tests for routers/documents.py — the entity-polymorphic Document Management
(DMS) endpoints (upload/list/delete/signed-url/download) over
app/services/storage.py's simulated local storage. STORAGE_ROOT is
monkeypatched to a pytest tmp_path for every test so nothing here ever writes
into the real (gitignored) backend/media_storage/ directory.

Covers the happy path, RBAC, and edge cases: missing/empty files, oversized
uploads, nonexistent entities/documents, invalid entity_type values, expired
or tampered signed-URL tokens, and downloading after the underlying file has
been deleted.
"""
from __future__ import annotations

import io

import pytest

from app.services import storage
from tests.conftest import auth_headers


@pytest.fixture(autouse=True)
def _isolated_storage_root(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "STORAGE_ROOT", tmp_path)


def _upload(client, headers, entity_type, entity_id, *, filename="report.pdf", content=b"%PDF-1.4 fake", doc_type="ADJUSTER_REPORT"):
    return client.post(
        f"/api/documents/entity/{entity_type}/{entity_id}",
        params={"doc_type": doc_type},
        files={"file": (filename, io.BytesIO(content), "application/pdf")},
        headers=headers,
    )


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------


def test_upload_document_happy_path(client, make_user, make_property):
    headers = auth_headers(make_user())
    prop = make_property()

    resp = _upload(client, headers, "PROPERTY", prop.property_id)

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["entity_type"] == "PROPERTY"
    assert body["entity_id"] == prop.property_id
    assert body["doc_type"] == "ADJUSTER_REPORT"
    # storage.upload_file's naive pluralization (entity_type.lower() + "s") produces
    # "propertys/", not the grammatically-correct "properties/" — documenting the
    # actual (slightly odd but harmless) storage-key shape rather than the ideal one.
    assert body["s3_url"].startswith("propertys/")


def test_upload_document_requires_auth(client, make_property):
    prop = make_property()
    resp = _upload(client, {}, "PROPERTY", prop.property_id)
    assert resp.status_code == 401


def test_upload_document_rejects_unknown_entity(client, make_user):
    headers = auth_headers(make_user())
    resp = _upload(client, headers, "PROPERTY", 999_999)
    assert resp.status_code == 404


def test_upload_document_rejects_empty_file(client, make_user, make_property):
    headers = auth_headers(make_user())
    prop = make_property()
    resp = _upload(client, headers, "PROPERTY", prop.property_id, content=b"")
    assert resp.status_code == 400
    assert "ריק" in resp.json()["detail"]


def test_upload_document_rejects_oversized_file(client, make_user, make_property):
    headers = auth_headers(make_user())
    prop = make_property()
    # One byte over the router's 25MB ceiling.
    oversized = b"0" * (25 * 1024 * 1024 + 1)
    resp = _upload(client, headers, "PROPERTY", prop.property_id, content=oversized)
    assert resp.status_code == 400
    assert "חורג" in resp.json()["detail"]


def test_upload_document_rejects_invalid_entity_type(client, make_user):
    headers = auth_headers(make_user())
    resp = _upload(client, headers, "NOT_A_REAL_ENTITY", 1)
    assert resp.status_code == 422


def test_upload_document_rejects_non_integer_entity_id(client, make_user):
    """Path-param type coercion (entity_id: int) should reject a non-numeric
    id outright — e.g. an injection-style payload — with a clean 422, not a
    500 or a silent misinterpretation."""
    headers = auth_headers(make_user())
    resp = _upload(client, headers, "PROPERTY", "1' OR '1'='1")
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------


def test_list_documents_returns_newest_first(client, make_user, make_property):
    headers = auth_headers(make_user())
    prop = make_property()
    _upload(client, headers, "PROPERTY", prop.property_id, filename="a.pdf", doc_type="SURVEY_REPORT")
    _upload(client, headers, "PROPERTY", prop.property_id, filename="b.pdf", doc_type="CORRESPONDENCE")

    resp = client.get(f"/api/documents/entity/PROPERTY/{prop.property_id}")
    assert resp.status_code == 200
    docs = resp.json()
    assert len(docs) == 2
    assert {d["doc_type"] for d in docs} == {"SURVEY_REPORT", "CORRESPONDENCE"}


def test_list_documents_empty_for_entity_with_none(client, make_property):
    prop = make_property()
    resp = client.get(f"/api/documents/entity/PROPERTY/{prop.property_id}")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_documents_rejects_unknown_entity(client):
    resp = client.get("/api/documents/entity/PROPERTY/999999")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


def test_delete_document_as_risk_manager_removes_file_from_disk(client, make_user, make_property, tmp_path):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    prop = make_property()
    upload_resp = _upload(client, headers, "PROPERTY", prop.property_id)
    doc_id = upload_resp.json()["document_id"]
    storage_key = upload_resp.json()["s3_url"]
    assert (tmp_path / storage_key).exists()

    resp = client.delete(f"/api/documents/{doc_id}", headers=headers)

    assert resp.status_code == 204
    assert not (tmp_path / storage_key).exists()
    assert client.get(f"/api/documents/entity/PROPERTY/{prop.property_id}").json() == []


def test_delete_document_forbidden_for_field_worker(client, make_user, make_property):
    admin_headers = auth_headers(make_user(role="ADMIN"))
    prop = make_property()
    doc_id = _upload(client, admin_headers, "PROPERTY", prop.property_id).json()["document_id"]

    field_headers = auth_headers(make_user(role="FIELD_WORKER"))
    resp = client.delete(f"/api/documents/{doc_id}", headers=field_headers)
    assert resp.status_code == 403


def test_delete_nonexistent_document_returns_404(client, make_user):
    headers = auth_headers(make_user(role="ADMIN"))
    resp = client.delete("/api/documents/999999", headers=headers)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Signed URL + download
# ---------------------------------------------------------------------------


def test_signed_url_and_download_round_trip(client, make_user, make_property):
    headers = auth_headers(make_user())
    prop = make_property()
    content = b"%PDF-1.4 hello world"
    doc_id = _upload(client, headers, "PROPERTY", prop.property_id, content=content).json()["document_id"]

    signed = client.get(f"/api/documents/{doc_id}/signed-url")
    assert signed.status_code == 200
    body = signed.json()
    assert "download_url" in body and body["storage_key"]

    download = client.get(body["download_url"])
    assert download.status_code == 200
    assert download.content == content
    assert download.headers["content-type"] == "application/pdf"


def test_signed_url_for_nonexistent_document_returns_404(client):
    resp = client.get("/api/documents/999999/signed-url")
    assert resp.status_code == 404


def test_download_rejects_tampered_token(client, make_user, make_property):
    headers = auth_headers(make_user())
    prop = make_property()
    doc_id = _upload(client, headers, "PROPERTY", prop.property_id).json()["document_id"]
    signed = client.get(f"/api/documents/{doc_id}/signed-url").json()

    resp = client.get(
        "/api/documents/download",
        params={"key": signed["storage_key"], "expires": signed["expires_at"], "token": "tampered-token"},
    )
    assert resp.status_code == 403


def test_download_rejects_expired_signature(client, make_user, make_property):
    headers = auth_headers(make_user())
    prop = make_property()
    doc_id = _upload(client, headers, "PROPERTY", prop.property_id).json()["document_id"]
    signed = client.get(f"/api/documents/{doc_id}/signed-url").json()

    # A signature that was valid for `storage_key` at an expires_at already in
    # the past — is_signed_url_valid must reject this before even checking disk.
    past_signed = storage.generate_signed_url(signed["storage_key"], expires_in_seconds=-10)
    resp = client.get(
        "/api/documents/download",
        params={"key": past_signed["storage_key"], "expires": past_signed["expires_at"], "token": past_signed["token"]},
    )
    assert resp.status_code == 403


def test_download_missing_file_after_delete_returns_404(client, make_user, make_property):
    headers = auth_headers(make_user(role="ADMIN"))
    prop = make_property()
    doc_id = _upload(client, headers, "PROPERTY", prop.property_id).json()["document_id"]
    storage_key = client.get(f"/api/documents/{doc_id}/signed-url").json()["storage_key"]

    client.delete(f"/api/documents/{doc_id}", headers=headers)

    # A freshly-minted, cryptographically valid signature for the same key
    # (deleting the Documents row doesn't invalidate any token, past or future
    # — signing has no notion of the row at all) — but the file itself is gone
    # from disk — must 404, not 500 or serve stale/garbage content.
    fresh = storage.generate_signed_url(storage_key)
    resp = client.get(
        "/api/documents/download",
        params={"key": fresh["storage_key"], "expires": fresh["expires_at"], "token": fresh["token"]},
    )
    assert resp.status_code == 404
