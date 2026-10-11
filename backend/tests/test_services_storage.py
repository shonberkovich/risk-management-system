"""Tests for services/storage.py's file-name handling: every upload gets its own key
(same-named uploads must not overwrite each other) and a client-supplied name can never
place a file outside STORAGE_ROOT. STORAGE_ROOT is monkeypatched to a pytest tmp_path."""
from __future__ import annotations

import pytest

from app.services import storage


@pytest.fixture(autouse=True)
def _isolated_storage_root(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "STORAGE_ROOT", tmp_path / "media_storage")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("photo.jpg", "photo.jpg"),
        ("דוח סקר.pdf", "דוח סקר.pdf"),
        ("../../../../etc/passwd", "passwd"),
        ("..\\..\\windows\\win.ini", "win.ini"),
        ("C:\\fakepath\\scan.pdf", "scan.pdf"),
        ("a<b>c:d\"e|f?g*h.txt", "a_b_c_d_e_f_g_h.txt"),
        ("bad\x00name\x1f.png", "bad_name_.png"),
        ("..", "file"),
        ("   ", "file"),
        ("dir/", "file"),
        (" .hidden. ", "hidden"),
    ],
)
def test_safe_filename(raw, expected):
    assert storage.safe_filename(raw) == expected


def test_safe_filename_truncates_but_keeps_the_extension():
    name = storage.safe_filename("x" * 600 + ".pdf")
    assert len(name) == storage.MAX_FILENAME_CHARS
    assert name.endswith(".pdf")


def test_resolve_key_rejects_keys_outside_the_root():
    assert storage.resolve_key("emails/1/a.pdf") is not None
    assert storage.resolve_key("../outside.txt") is None
    assert storage.resolve_key("emails/1/../../../outside.txt") is None
    assert storage.resolve_key("") is None


def test_upload_with_a_traversal_name_stays_inside_the_root(tmp_path):
    result = storage.upload_file(b"payload", "../../outside.txt", "EMAIL", 7)

    assert not (tmp_path / "outside.txt").exists()
    assert result.storage_key.startswith("emails/7/")
    assert result.storage_key.endswith("_outside.txt")
    assert (storage.STORAGE_ROOT / result.storage_key).read_bytes() == b"payload"


def test_same_named_uploads_get_distinct_keys_and_keep_their_bytes():
    first = storage.upload_file(b"FIRST", "image.jpg", "INCIDENT", 1)
    second = storage.upload_file(b"SECOND", "image.jpg", "INCIDENT", 1)

    assert first.storage_key != second.storage_key
    assert (storage.STORAGE_ROOT / first.storage_key).read_bytes() == b"FIRST"
    assert storage.delete_file(second.storage_key) is True
    assert (storage.STORAGE_ROOT / first.storage_key).read_bytes() == b"FIRST"


def test_upload_content_type_comes_from_the_extension():
    assert storage.upload_file(b"x", "a.PDF", "PROPERTY", 1).content_type == "application/pdf"
    assert storage.upload_file(b"x", "a.exe", "PROPERTY", 1).content_type == "application/octet-stream"


def test_delete_file_refuses_a_key_outside_the_root(tmp_path):
    victim = tmp_path / "victim.txt"
    victim.write_text("keep me")
    assert storage.delete_file("../victim.txt") is False
    assert victim.exists()


def test_download_url_percent_encodes_the_key():
    signed = storage.generate_signed_url("documents/1/abc_R&D #1+2.pdf")
    url = storage.download_url("/api/documents/download", signed)
    assert url.startswith("/api/documents/download?key=documents/1/abc_R%26D%20%231%2B2.pdf&expires=")
