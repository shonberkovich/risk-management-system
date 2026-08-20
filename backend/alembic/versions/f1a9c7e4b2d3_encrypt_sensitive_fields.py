"""Encrypt sensitive fields: Claims.adjuster_name, Insurance_Policies.per_event_limit,
Policy_Assets.specific_deductible, Audit_Log.old_value/new_value

TODO_SPEC.md §3, "הצפנת שדות רגישים". Switches these columns to
`app.services.encryption.EncryptedString`/`EncryptedText` (see that module's docstring
for the full rationale and which columns stay excluded, e.g. annual_premium/
total_limit/deductible_default, because those are summed across many rows for loss
ratio / cashflow / executive-summary calculations).

Claims.adjuster_name (NVARCHAR) is only widened to fit ciphertext — no type change.
Insurance_Policies.per_event_limit and Policy_Assets.specific_deductible go from
DECIMAL(18,2) to NVARCHAR(64): existing numeric values are implicitly CAST to text by
SQL Server's ALTER COLUMN (e.g. 50000.00 -> '50000.00') rather than re-encrypted in
place. That's intentional and consistent with how `Claim_Payments.reference_number`
was rolled out originally: `EncryptedString.process_result_value` already tolerates
plaintext-in-the-column on read (falls back to the raw value on `InvalidToken`) so old
rows stay readable without a backfill migration; they simply get encrypted the next
time the row is written through the ORM. Audit_Log.old_value/new_value keep their
NVARCHAR(MAX) type (only the application-level meaning changes), so no ALTER COLUMN is
needed for those two.

Revision ID: f1a9c7e4b2d3
Revises: e5f7a2c9b3d1
Create Date: 2026-08-20
"""
import sqlalchemy as sa
from alembic import op

revision = 'f1a9c7e4b2d3'
down_revision = 'e5f7a2c9b3d1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        'Claims', 'adjuster_name',
        existing_type=sa.Unicode(100),
        type_=sa.Unicode(255),
        existing_nullable=True,
    )
    op.alter_column(
        'Insurance_Policies', 'per_event_limit',
        existing_type=sa.Numeric(18, 2),
        type_=sa.Unicode(64),
        existing_nullable=True,
    )
    op.alter_column(
        'Policy_Assets', 'specific_deductible',
        existing_type=sa.Numeric(18, 2),
        type_=sa.Unicode(64),
        existing_nullable=True,
    )


def downgrade() -> None:
    # Reverse direction: NVARCHAR -> DECIMAL requires the column to actually contain
    # numeric text at the time of downgrade (true once every row has been re-written
    # through the ORM post-upgrade, encrypted-or-not; a column still holding Fernet
    # ciphertext will fail this CAST — decrypt those rows back to plaintext first).
    op.alter_column(
        'Policy_Assets', 'specific_deductible',
        existing_type=sa.Unicode(64),
        type_=sa.Numeric(18, 2),
        existing_nullable=True,
    )
    op.alter_column(
        'Insurance_Policies', 'per_event_limit',
        existing_type=sa.Unicode(64),
        type_=sa.Numeric(18, 2),
        existing_nullable=True,
    )
    op.alter_column(
        'Claims', 'adjuster_name',
        existing_type=sa.Unicode(255),
        type_=sa.Unicode(100),
        existing_nullable=True,
    )
