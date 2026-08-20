"""Notification_Log table

Audit trail of notifications actually dispatched by
services/notifications.dispatch_notifications — one row per (alert, recipient,
channel) combination "sent" (TODO_SPEC.md §1, "טבלת Notification_Log"). Hand-written
(no live DB to autogenerate against, same as 8f2a4c6e1d09 / c3d9a17f4b62) — see
CLAUDE.md for why.

Revision ID: d4e1b298a715
Revises: c3d9a17f4b62
Create Date: 2026-08-20
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd4e1b298a715'
down_revision = 'c3d9a17f4b62'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'Notification_Log',
        sa.Column('log_id', sa.BigInteger(), nullable=False),
        sa.Column('alert_type', sa.Unicode(length=50), nullable=False),
        sa.Column('severity', sa.Unicode(length=20), nullable=False),
        sa.Column('recipient_role', sa.Unicode(length=30), nullable=False),
        sa.Column('recipient_name', sa.Unicode(length=100), nullable=False),
        sa.Column('channel', sa.Unicode(length=10), nullable=False),
        sa.Column('contact', sa.Unicode(length=200), nullable=False),
        sa.Column('title', sa.Unicode(length=200), nullable=False),
        sa.Column('message', sa.UnicodeText(), nullable=False),
        sa.Column('property_ids', sa.Unicode(length=500), nullable=False),
        sa.Column('value', sa.Numeric(18, 4), nullable=False),
        sa.Column('threshold', sa.Numeric(18, 4), nullable=False),
        sa.Column('status', sa.Unicode(length=20), nullable=False),
        sa.Column('sent_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('log_id'),
    )
    op.create_index('IX_Notification_Log_sent_at', 'Notification_Log', ['sent_at'])


def downgrade() -> None:
    op.drop_index('IX_Notification_Log_sent_at', table_name='Notification_Log')
    op.drop_table('Notification_Log')
