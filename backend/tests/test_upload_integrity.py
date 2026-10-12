"""Upload rules on routers/documents.py and routers/media.py: the uploader recorded on
a document is always the signed-in caller (a client-supplied id used to be trusted),
doc_type is one of the types the upload screens offer, a very long client file name
still fits the NVARCHAR(500) path column and Windows' MAX_PATH, and incident media only takes the types the
app can show (services/storage.py ALLOWED_CONTENT_TYPES)."""
from __future__ import annotations

import io

import pytest

from app import models
from app.services import storage
from tests.conftest import auth_headers


@pytest.fixture(autouse=True)
def _isolated_storage_root(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "STORAGE_ROOT", tmp_path)


def _upload_document(client, headers, entity_id, *, filename="report.pdf", params=None):
    return client.post(
        f"/api/documents/entity/PROPERTY/{entity_id}",
        params={"doc_type": "ADJUSTER_REPORT", **(params or {})},
        files={"file": (filename, io.BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
        headers=headers,
    )


def test_the_uploader_is_the_caller_even_when_another_id_is_sent(client, db, make_user, make_property):
    caller = make_user()
    other = make_user()
    prop = make_property()

    resp = _upload_document(client, auth_headers(caller), prop.property_id, params={"uploaded_by": other.user_id})

    assert resp.status_code == 201, resp.text
    assert resp.json()["uploaded_by"] == caller.user_id
    assert db.get(models.Document, resp.json()["document_id"]).uploaded_by == caller.user_id


def test_a_nonexistent_uploaded_by_id_no_longer_matters(client, make_user, make_property):
    prop = make_property()
    resp = _upload_document(client, auth_headers(make_user()), prop.property_id, params={"uploaded_by": 999_999})
    assert resp.status_code == 201, resp.text


@pytest.mark.parametrize("doc_type", ["POLICY_DOCUMENT", "ADJUSTER_REPORT", "CORRESPONDENCE", "PHOTO", "SURVEY_REPORT"])
def test_every_offered_doc_type_is_accepted(client, make_user, make_property, doc_type):
    prop = make_property()
    resp = _upload_document(client, auth_headers(make_user()), prop.property_id, params={"doc_type": doc_type})
    assert resp.status_code == 201, resp.text
    assert resp.json()["doc_type"] == doc_type


@pytest.mark.parametrize("doc_type", ["INVOICE", "photo", ""])
def test_an_unknown_doc_type_is_422(client, make_user, make_property, doc_type):
    prop = make_property()
    resp = _upload_document(client, auth_headers(make_user()), prop.property_id, params={"doc_type": doc_type})
    assert resp.status_code == 422, resp.text


def test_a_very_long_file_name_is_shortened_to_fit_the_path_column(client, make_user, make_property):
    prop = make_property()
    resp = _upload_document(client, auth_headers(make_user()), prop.property_id, filename="ק" * 400 + ".pdf")
    assert resp.status_code == 201, resp.text
    s3_url = resp.json()["s3_url"]
    assert len(s3_url) <= 500
    assert s3_url.endswith(".pdf")


def _upload_media(client, headers, incident_id, filename):
    return client.post(
        f"/api/incidents/{incident_id}/media",
        files={"file": (filename, io.BytesIO(b"some bytes"), "application/octet-stream")},
        headers=headers,
    )


@pytest.mark.parametrize("filename", ["photo.jpg", "photo.JPEG", "scan.png", "clip.mp4", "clip.MOV", "report.pdf"])
def test_incident_media_accepts_the_types_the_app_shows(client, make_user, make_property, make_incident, filename):
    incident = make_incident(make_property().property_id)
    resp = _upload_media(client, auth_headers(make_user()), incident.incident_id, filename)
    assert resp.status_code == 201, resp.text


@pytest.mark.parametrize("filename", ["virus.exe", "animation.gif", "notes.txt", "photo.heic", "no_extension"])
def test_incident_media_rejects_other_types_with_a_clear_message(client, make_user, make_property, make_incident, filename):
    incident = make_incident(make_property().property_id)
    resp = _upload_media(client, auth_headers(make_user()), incident.incident_id, filename)
    assert resp.status_code == 400, resp.text
    assert "סוג קובץ לא נתמך" in resp.json()["detail"]
