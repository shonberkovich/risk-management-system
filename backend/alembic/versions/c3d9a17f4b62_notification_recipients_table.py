"""Notification_Recipients table

Extracts services/notifications.py's previously hardcoded DEFAULT_RECIPIENTS list
into a DB-backed table (TODO_SPEC.md §1), so recipients can eventually be managed
through the UI instead of requiring a code change. Hand-written (no live DB to
autogenerate against, same as 8f2a4c6e1d09) — see CLAUDE.md for why.

Revision ID: c3d9a17f4b62
Revises: 8f2a4c6e1d09
Create Date: 2026-08-20
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c3d9a17f4b62'
down_revision = '8f2a4c6e1d09'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'Notification_Recipients',
        sa.Column('recipient_id', sa.BigInteger(), nullable=False),
        sa.Column('role', sa.Unicode(length=30), nullable=False),
        sa.Column('display_name', sa.Unicode(length=100), nullable=False),
        sa.Column('email', sa.Unicode(length=200), nullable=False),
        sa.Column('phone', sa.Unicode(length=30), nullable=False),
        sa.Column('channels', sa.Unicode(length=30), nullable=False),
        sa.Column('min_severity', sa.Unicode(length=20), nullable=False, server_default='warning'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.PrimaryKeyConstraint('recipient_id'),
    )


def downgrade() -> None:
    op.drop_table('Notification_Recipients')
