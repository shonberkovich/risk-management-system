"""widen encrypted per_event_limit / specific_deductible to NVARCHAR(255)

Revision ID: d2b8f4a6c1e3
Revises: c7e2a9d4f1b5
Create Date: 2026-10-11 00:00:00.000000

f1a9c7e4b2d3 switched Insurance_Policies.per_event_limit and
Policy_Assets.specific_deductible to `EncryptedString` but sized them NVARCHAR(64) —
a Fernet token is never shorter than ~100 chars (version + timestamp + IV + one
AES block + HMAC, base64-encoded), so every non-NULL write to either column failed
on SQL Server with "String or binary data would be truncated" (SQLite, which the
test suite runs on, doesn't enforce the length, so it went unnoticed). 255 matches
the other two encrypted NVARCHAR columns (Claims.adjuster_name,
Claim_Payments.reference_number).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd2b8f4a6c1e3'
down_revision: Union[str, Sequence[str], None] = 'c7e2a9d4f1b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        'Insurance_Policies', 'per_event_limit',
        existing_type=sa.Unicode(64), type_=sa.Unicode(255), existing_nullable=True,
    )
    op.alter_column(
        'Policy_Assets', 'specific_deductible',
        existing_type=sa.Unicode(64), type_=sa.Unicode(255), existing_nullable=True,
    )


def downgrade() -> None:
    # Fails while either column holds ciphertext (> 64 chars) — NULL those values first.
    op.alter_column(
        'Policy_Assets', 'specific_deductible',
        existing_type=sa.Unicode(255), type_=sa.Unicode(64), existing_nullable=True,
    )
    op.alter_column(
        'Insurance_Policies', 'per_event_limit',
        existing_type=sa.Unicode(255), type_=sa.Unicode(64), existing_nullable=True,
    )
