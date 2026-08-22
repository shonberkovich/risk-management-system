"""Field-level encryption at rest for sensitive financial/PII columns.

Uses Fernet (AES-128-CBC + HMAC, from the `cryptography` package), keyed from
`settings.field_encryption_key` (plus optional previous keys for rotation — see the
"Key rotation" section below). This is deliberately narrow in scope: it is NOT applied
to columns that get summed/averaged across many rows —
`Claim_Payments.amount`, `Claim_Reserves.reserve_amount`, TIV/MFL inputs,
`Insurance_Policies.annual_premium`/`total_limit`/`deductible_default`, etc. —
because `services/kpi.py` and `services/financials.py` aggregate those (loss ratio,
cashflow, executive AI summaries) either in SQL Server itself or by summing many ORM
rows in Python; either way an encrypted blob can't be summed without decrypting every
row first, which defeats the point of aggregating and would be a much larger
architectural change than "add a column type."

Applied so far:
  - `Claim_Payments.reference_number` — a non-aggregated, non-searched identifier.
  - `Claims.adjuster_name` — the assigned loss adjuster's name (personal data), only
    ever displayed, never aggregated or filtered on.
  - `Insurance_Policies.per_event_limit` / `Policy_Assets.specific_deductible` —
    per-property/per-event coverage terms. Unlike `annual_premium`/`total_limit`, these
    are only ever read one row at a time (`services/retention.py`, single-property
    policy lookups in `routers/properties.py` / `routers/policies.py`), never summed
    across policies, so encrypting them doesn't touch any aggregation path.
  - `Audit_Log.old_value` / `new_value` — the audit trail's before/after snapshot of a
    mutating request's JSON body (see `middleware/audit.py`), which can itself contain
    other sensitive fields (e.g. the payload of a user-creation request). Never
    filtered/searched — `routers/audit.py` only filters on entity_type/entity_id/
    user_id/action/timestamp — so encrypting is transparent to every existing query.

All of the above are the same shape: sensitive, read-and-displayed-as-is, never summed
or filtered by value in SQL — exactly what "encrypt at rest" is meant for.

Considered and declined: `Emails.body_html` (TODO_SPEC.md "משימה 10" step 3,
explicitly optional) — unlike everything above, it's exactly the column a `LIKE`
search was added over in the same task (`services/email.py`'s `list_emails_for_user`,
`q` param), so it fails the "never filtered by value in SQL" test this module is
scoped to. See `models.Email`'s docstring for the full reasoning.

Key rotation: `_fernet()` returns a `cryptography.fernet.MultiFernet` built from
`[settings.field_encryption_key, *settings.field_encryption_key_previous_list]`. New writes
always encrypt under the first (current) key — that's `MultiFernet`'s documented contract —
while reads try every key in the list in order, so ciphertext written under a since-rotated-out
key keeps decrypting. To rotate: move the current `FIELD_ENCRYPTION_KEY` into the front of
`FIELD_ENCRYPTION_KEY_PREVIOUS`, generate a new `FIELD_ENCRYPTION_KEY`, deploy — see config.py
for the full procedure, including how to re-encrypt existing rows under the new key over time.

`EncryptedString` (bounded, like the underlying NVARCHAR(n) it replaces) and
`EncryptedText` (unbounded, NVARCHAR(MAX)) are SQLAlchemy `TypeDecorator`s: application
code reads/writes plain strings (or numbers — `policy.per_event_limit = 50000` works,
`str()` is applied automatically before encrypting) as usual; the ciphertext is what's
actually stored in and read from the column, transparently. Because a decrypted numeric
value comes back as a `str`, call sites that do arithmetic on a newly-encrypted "amount"
column must (and, checked against every call site above, already do) `float(...)` it
first rather than relying on it still being a native `Decimal`/`float`.
"""
from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from sqlalchemy import Unicode, UnicodeText
from sqlalchemy.types import TypeDecorator

from app.config import settings


def _fernet() -> MultiFernet:
    """A `MultiFernet` over [current key, *previous keys] — see the key-rotation section of
    this module's docstring. Encrypts with the current (first) key; decrypts with whichever
    key in the list actually works."""
    keys = [settings.field_encryption_key, *settings.field_encryption_key_previous_list]
    return MultiFernet([Fernet(k.encode()) for k in keys])


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
    doesn't need a backfill migration to remain readable. Legacy plaintext containing
    non-ASCII characters (e.g. a Hebrew `adjuster_name` seeded before this column was
    encrypted) fails even earlier than `InvalidToken` — `decrypt_value`'s
    `ciphertext.encode("ascii")` raises `UnicodeEncodeError` before Fernet ever gets to
    reject it as an invalid token — so that must be tolerated here too.
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
        except (InvalidToken, UnicodeError):
            return value


class EncryptedText(EncryptedString):
    """Same as `EncryptedString`, but backed by NVARCHAR(MAX) (`UnicodeText`) instead
    of a bounded NVARCHAR(n) — for fields with no natural length cap, e.g.
    `Audit_Log.old_value`/`new_value` (an arbitrary JSON request-body snapshot)."""

    impl = UnicodeText
