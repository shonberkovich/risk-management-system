"""Tests for routers/media.py — incident photo/video/PDF upload, list, delete,
and signed-URL download, over app/services/storage.py's simulated local
storage. STORAGE_ROOT is monkeypatched to a pytest tmp_path for every test so
nothing here ever writes into the real (gitignored) backend/media_storage/
directory.

EXIF/GPS extraction (storage.extract_image_metadata, a pure function already
covered indirectly by real JPEG bytes being painful to construct in a unit
test) is exercised here by mocking the *router's* bound reference to it —
same "mock the module's own bound name" convention test_api_integrations_external.py
uses for the real external connectors — so this file tests media.py's own
logic (captured_at fallback, malformed-datetime handling, GPS field mapping)
without needing a real EXIF-bearing image fixture.
"""
from __future__ import annotations

import io
from datetime import datetime, timedelta

import pytest

from app.routers import media
from app.services import storage
from tests.conftest import auth_headers


@pytest.fixture(autouse=True)
def _isolated_storage_root(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "STORAGE_ROOT", tmp_path)


def _upload(client, headers, incident_id, *, filename="photo.jpg", content=b"\xff\xd8\xff fake jpeg bytes"):
    return client.post(
        f"/api/incidents/{incident_id}/media",
        files={"file": (filename, io.BytesIO(content), "image/jpeg")},
        headers=headers,
    )


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------


def test_upload_media_happy_path_without_exif(client, make_user, make_property, make_incident, monkeypatch):
    monkeypatch.setattr(media.storage, "extract_image_metadata", lambda *_: None)
    headers = auth_headers(make_user())
    incident = make_incident(make_property().property_id)

    before = datetime.now()
    resp = _upload(client, headers, incident.incident_id)
    after = datetime.now()

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["incident_id"] == incident.incident_id
    assert body["gps_latitude"] is None
    assert body["gps_longitude"] is None
    # No EXIF -> captured_at falls back to "now" at upload time.
    captured_at = datetime.fromisoformat(body["captured_at"])
    assert before - timedelta(seconds=5) <= captured_at <= after + timedelta(seconds=5)


def test_upload_media_uses_exif_datetime_and_gps(client, make_user, make_property, make_incident, monkeypatch):
    monkeypatch.setattr(
        media.storage,
        "extract_image_metadata",
        lambda *_: {"captured_at": "2026:03:15 08:30:00", "gps": {"latitude": 32.05, "longitude": 34.77}},
    )
    headers = auth_headers(make_user())
    incident = make_incident(make_property().property_id)

    resp = _upload(client, headers, incident.incident_id)

    assert resp.status_code == 201
    body = resp.json()
    assert body["captured_at"].startswith("2026-03-15T08:30:00")
    assert body["gps_latitude"] == 32.05
    assert body["gps_longitude"] == 34.77


def test_upload_media_falls_back_to_now_on_malformed_exif_datetime(client, make_user, make_property, make_incident, monkeypatch):
    """A real-world camera/app could write a malformed or non-EXIF-standard
    DateTimeOriginal — _parse_exif_datetime must degrade to "now" rather than
    raising and 500ing the whole upload."""
    monkeypatch.setattr(
        media.storage,
        "extract_image_metadata",
        lambda *_: {"captured_at": "not-a-real-timestamp", "gps": None},
    )
    headers = auth_headers(make_user())
    incident = make_incident(make_property().property_id)

    resp = _upload(client, headers, incident.incident_id)

    assert resp.status_code == 201
    # Just needs to be a valid, recent timestamp — proves no exception leaked
    # to a 500 and no bogus "1899"-style default sneaked in.
    captured_at = datetime.fromisoformat(resp.json()["captured_at"])
    assert captured_at.year == datetime.now().year


def test_upload_media_requires_auth(client, make_property, make_incident):
    incident = make_incident(make_property().property_id)
    resp = _upload(client, {}, incident.incident_id)
    assert resp.status_code == 401


def test_upload_media_rejects_unknown_incident(client, make_user):
    headers = auth_headers(make_user())
    resp = _upload(client, headers, 999999)
    assert resp.status_code == 404


def test_upload_media_rejects_empty_file(client, make_user, make_property, make_incident):
    headers = auth_headers(make_user())
    incident = make_incident(make_property().property_id)
    resp = _upload(client, headers, incident.incident_id, content=b"")
    assert resp.status_code == 400
    assert "ריק" in resp.json()["detail"]


def test_upload_media_rejects_oversized_file(client, make_user, make_property, make_incident):
    headers = auth_headers(make_user())
    incident = make_incident(make_property().property_id)
    oversized = b"0" * (25 * 1024 * 1024 + 1)
    resp = _upload(client, headers, incident.incident_id, content=oversized)
    assert resp.status_code == 400
    assert "חורג" in resp.json()["detail"]


def test_upload_media_rejects_non_integer_incident_id(client, make_user):
    headers = auth_headers(make_user())
    resp = client.post(
        "/api/incidents/not-a-number/media",
        files={"file": ("photo.jpg", io.BytesIO(b"data"), "image/jpeg")},
        headers=headers,
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------


def test_list_media_empty_for_incident_with_none(client, make_property, make_incident):
    incident = make_incident(make_property().property_id)
    resp = client.get(f"/api/incidents/{incident.incident_id}/media")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_media_rejects_unknown_incident(client):
    resp = client.get("/api/incidents/999999/media")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


def test_delete_media_as_admin_removes_file_from_disk(client, make_user, make_property, make_incident, monkeypatch, tmp_path):
    monkeypatch.setattr(media.storage, "extract_image_metadata", lambda *_: None)
    headers = auth_headers(make_user(role="ADMIN"))
    incident = make_incident(make_property().property_id)
    upload = _upload(client, headers, incident.incident_id).json()
    assert (tmp_path / upload["file_path"]).exists()

    resp = client.delete(f"/api/media/{upload['media_id']}", headers=headers)

    assert resp.status_code == 204
    assert not (tmp_path / upload["file_path"]).exists()
    assert client.get(f"/api/incidents/{incident.incident_id}/media").json() == []


def test_delete_media_forbidden_for_property_manager(client, make_user, make_property, make_incident, monkeypatch):
    monkeypatch.setattr(media.storage, "extract_image_metadata", lambda *_: None)
    admin_headers = auth_headers(make_user(role="ADMIN"))
    incident = make_incident(make_property().property_id)
    media_id = _upload(client, admin_headers, incident.incident_id).json()["media_id"]

    pm_headers = auth_headers(make_user(role="PROPERTY_MANAGER"))
    resp = client.delete(f"/api/media/{media_id}", headers=pm_headers)
    assert resp.status_code == 403


def test_delete_nonexistent_media_returns_404(client, make_user):
    headers = auth_headers(make_user(role="ADMIN"))
    resp = client.delete("/api/media/999999", headers=headers)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Signed URL + download
# ---------------------------------------------------------------------------


def test_signed_url_and_download_round_trip(client, make_user, make_property, make_incident, monkeypatch):
    monkeypatch.setattr(media.storage, "extract_image_metadata", lambda *_: None)
    headers = auth_headers(make_user())
    incident = make_incident(make_property().property_id)
    content = b"\xff\xd8\xff real-ish jpeg bytes"
    media_id = _upload(client, headers, incident.incident_id, content=content).json()["media_id"]

    signed = client.get(f"/api/media/{media_id}/signed-url")
    assert signed.status_code == 200
    body = signed.json()
    assert "download_url" in body and body["storage_key"]

    download = client.get(body["download_url"])
    assert download.status_code == 200
    assert download.content == content
    assert download.headers["content-type"] == "image/jpeg"


def test_signed_url_for_nonexistent_media_returns_404(client):
    resp = client.get("/api/media/999999/signed-url")
    assert resp.status_code == 404


def test_download_rejects_tampered_token(client, make_user, make_property, make_incident, monkeypatch):
    monkeypatch.setattr(media.storage, "extract_image_metadata", lambda *_: None)
    headers = auth_headers(make_user())
    incident = make_incident(make_property().property_id)
    media_id = _upload(client, headers, incident.incident_id).json()["media_id"]
    signed = client.get(f"/api/media/{media_id}/signed-url").json()

    resp = client.get(
        "/api/media/download",
        params={"key": signed["storage_key"], "expires": signed["expires_at"], "token": "tampered"},
    )
    assert resp.status_code == 403


def test_download_rejects_expired_signature(client, make_user, make_property, make_incident, monkeypatch):
    monkeypatch.setattr(media.storage, "extract_image_metadata", lambda *_: None)
    headers = auth_headers(make_user())
    incident = make_incident(make_property().property_id)
    media_id = _upload(client, headers, incident.incident_id).json()["media_id"]
    storage_key = client.get(f"/api/media/{media_id}/signed-url").json()["storage_key"]

    expired = storage.generate_signed_url(storage_key, expires_in_seconds=-10)
    resp = client.get(
        "/api/media/download",
        params={"key": expired["storage_key"], "expires": expired["expires_at"], "token": expired["token"]},
    )
    assert resp.status_code == 403


def test_download_missing_file_after_delete_returns_404(client, make_user, make_property, make_incident, monkeypatch):
    monkeypatch.setattr(media.storage, "extract_image_metadata", lambda *_: None)
    headers = auth_headers(make_user(role="ADMIN"))
    incident = make_incident(make_property().property_id)
    media_id = _upload(client, headers, incident.incident_id).json()["media_id"]
    storage_key = client.get(f"/api/media/{media_id}/signed-url").json()["storage_key"]

    client.delete(f"/api/media/{media_id}", headers=headers)

    fresh = storage.generate_signed_url(storage_key)
    resp = client.get(
        "/api/media/download",
        params={"key": fresh["storage_key"], "expires": fresh["expires_at"], "token": fresh["token"]},
    )
    assert resp.status_code == 404
