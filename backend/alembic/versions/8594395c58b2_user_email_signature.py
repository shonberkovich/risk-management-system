"""user email signature

Revision ID: 8594395c58b2
Revises: b66e5e16401b
Create Date: 2026-08-22 17:48:50.218680

Hand-trimmed: autogenerate also re-flagged the usual fixed set of cosmetic diffs
(DATETIME2 vs DateTime rendering, indexes schema.sql created that aren't mirrored
as Index(...) in models.py, FK name churn) across many unrelated tables — see
CLAUDE.md's Alembic note. Only the real change (TODO_SPEC.md "משימה 14" step 1,
adding User.signature) is kept here.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '8594395c58b2'
down_revision: Union[str, Sequence[str], None] = 'b66e5e16401b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('Users', sa.Column('signature', sa.UnicodeText(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('Users', 'signature')
