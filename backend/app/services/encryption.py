"""Field-level encryption at rest for sensitive financial columns.

Uses Fernet (AES-128-CBC + HMAC, from the `cryptography` package) with a single
symmetric key from `settings.field_encryption_key`. This is deliberately narrow in
scope: it is NOT applied to columns the SQL layer needs to aggregate (SUM/AVG) —
`Claim_Payments.amount`, `Claim_Reserves.reserve_amount`, TIV/MFL inputs, etc. — because
`services/kpi.py` computes those aggregates in SQL Server itself, and an encrypted blob
can't be summed by the database. Encrypting those would require pulling every row into
Python to decrypt-then-aggregate, which defeats the point of doing aggregation in SQL and
would be a much larger architectural change than "add a column type."

Instead this is applied to `Claim_Payments.reference_number` (see models.py) — a
non-aggregated, non-searched identifier that's exactly the kind of field "encrypt at
rest" is meant for: sensitive-ish, read-and-displayed-as-is, never summed or filtered by
range in SQL.

`EncryptedString` is a SQLAlchemy `TypeDecorator`: application code reads/writes plain
strings as usual (`payment.reference_number = "REF-123"`); the ciphertext is what's
actually stored in and read from the NVARCHAR column, transparently.
"""
from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import Unicode
from sqlalchemy.types import TypeDecorator

from app.config import settings


def _fernet() -> Fernet:
    return Fernet(settings.field_encryption_key.encode())


def encrypt_value(plaintext: str) -> str:
    """Encrypt a plaintext string, returning a url-safe base64 ciphertext string."""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_value(ciphertext: str) -> str:
    """Decrypt a ciphertext string produced by `encrypt_value`.

    Raises `cryptography.fernet.InvalidToken` if the value is not valid ciphertext for
    the configured key (wrong/rotated key, or corrupted data).
    """
    return _fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")


class EncryptedString(TypeDecorator):
    """Column type that transparently encrypts on write / decrypts on read.

    Values that are already plaintext in the database (e.g. rows inserted before this
    type was introduced) are tolerated on read: if decryption fails with `InvalidToken`,
    the raw stored value is returned as-is rather than raising, so existing demo data
    doesn't need a backfill migration to remain readable.
    """

    impl = Unicode
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return encrypt_value(str(value))

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        try:
            return decrypt_value(value)
        except InvalidToken:
            return value
