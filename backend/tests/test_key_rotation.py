"""Tests for the key-rotation mechanisms added for TODO_SPEC.md §3 "מוכנות לפרודקשן":
JWT signing-key rotation (services/auth.py) and field-encryption-key rotation
(services/encryption.py), plus the environment-driven force_https default (config.py).
"""
from __future__ import annotations

import jwt as pyjwt
import pytest
from cryptography.fernet import Fernet

from app.config import Settings, settings
from app.services import auth, encryption


# --- JWT key rotation -------------------------------------------------------------

def test_decode_token_accepts_current_key(monkeypatch):
    token = auth.create_access_token(user_id=1, role="ADMIN")
    payload = auth.decode_token(token, "access")
    assert payload["sub"] == "1"


def test_decode_token_rejects_unknown_key():
    # Token signed with a key that is neither current nor in the previous-keys list.
    token = pyjwt.encode(
        {"sub": "1", "role": "ADMIN", "type": "access"}, "some-other-key", algorithm="HS256"
    )
    with pytest.raises(auth.TokenError):
        auth.decode_token(token, "access")


def test_decode_token_accepts_rotated_out_key(monkeypatch):
    """Simulates a rotation: a token signed under the *old* key must still verify once that
    key has been moved into jwt_previous_secret_keys, even though jwt_secret_key has changed."""
    old_key = settings.jwt_secret_key
    old_token = auth.create_access_token(user_id=7, role="RISK_MANAGER")

    monkeypatch.setattr(settings, "jwt_secret_key", "brand-new-rotated-in-key")
    monkeypatch.setattr(settings, "jwt_previous_secret_keys", old_key)

    payload = auth.decode_token(old_token, "access")
    assert payload["sub"] == "7"

    # New tokens sign under the new current key, and old tokens keep working too.
    new_token = auth.create_access_token(user_id=7, role="RISK_MANAGER")
    assert auth.decode_token(new_token, "access")["sub"] == "7"
    assert auth.decode_token(old_token, "access")["sub"] == "7"


def test_decode_token_drops_key_once_removed_from_previous_list(monkeypatch):
    old_key = settings.jwt_secret_key
    old_token = auth.create_access_token(user_id=3, role="ADMIN")

    monkeypatch.setattr(settings, "jwt_secret_key", "another-new-key")
    monkeypatch.setattr(settings, "jwt_previous_secret_keys", "")  # old key fully retired

    with pytest.raises(auth.TokenError):
        auth.decode_token(old_token, "access")


# --- Field-encryption key rotation ------------------------------------------------

def test_encrypt_decrypt_round_trip_unaffected_by_rotation_support():
    ciphertext = encryption.encrypt_value("classified")
    assert encryption.decrypt_value(ciphertext) == "classified"


def test_decrypt_value_accepts_rotated_out_encryption_key(monkeypatch):
    old_key = settings.field_encryption_key
    old_ciphertext = encryption.encrypt_value("secret coverage amount")

    new_key = Fernet.generate_key().decode()
    monkeypatch.setattr(settings, "field_encryption_key", new_key)
    monkeypatch.setattr(settings, "field_encryption_key_previous", old_key)

    # Old ciphertext (encrypted under the now-rotated-out key) still decrypts.
    assert encryption.decrypt_value(old_ciphertext) == "secret coverage amount"

    # New writes encrypt under the new current key — not decryptable by the old key alone.
    new_ciphertext = encryption.encrypt_value("new secret")
    with pytest.raises(Exception):
        Fernet(old_key.encode()).decrypt(new_ciphertext.encode("ascii"))
    assert encryption.decrypt_value(new_ciphertext) == "new secret"


def test_decrypt_value_fails_once_key_fully_retired(monkeypatch):
    old_key = settings.field_encryption_key
    old_ciphertext = encryption.encrypt_value("will become unreadable")

    monkeypatch.setattr(settings, "field_encryption_key", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "field_encryption_key_previous", "")  # old key dropped

    from cryptography.fernet import InvalidToken

    with pytest.raises(InvalidToken):
        encryption.decrypt_value(old_ciphertext)


# --- Environment-driven force_https default ---------------------------------------

def test_force_https_defaults_false_in_development():
    s = Settings(_env_file=None, environment="development")
    assert s.force_https is False


def test_force_https_defaults_true_in_production():
    s = Settings(_env_file=None, environment="production")
    assert s.force_https is True


def test_force_https_explicit_value_wins_over_production_default():
    s = Settings(_env_file=None, environment="production", force_https=False)
    assert s.force_https is False
