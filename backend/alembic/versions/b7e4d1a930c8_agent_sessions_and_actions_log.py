"""Agent_Sessions and Agent_Actions_Log tables

Short/long-term context memory and action audit trail for the AI agent
orchestrator (TODO_SPEC.md §1). Hand-written (no live DB to autogenerate
against, same as 8f2a4c6e1d09 / c3d9a17f4b62 / d4e1b298a715) — see CLAUDE.md
for why.

Revision ID: b7e4d1a930c8
Revises: 7c2e4f9a1b83
Create Date: 2026-08-21
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'b7e4d1a930c8'
down_revision = '7c2e4f9a1b83'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'Agent_Sessions',
        sa.Column('session_id', sa.Unicode(length=64), nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=True),
        sa.Column('context_data', sa.UnicodeText(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('session_id'),
        sa.ForeignKeyConstraint(['user_id'], ['Users.user_id']),
    )
    op.create_table(
        'Agent_Actions_Log',
        sa.Column('action_id', sa.BigInteger(), nullable=False),
        sa.Column('session_id', sa.Unicode(length=64), nullable=False),
        sa.Column('action_type', sa.Unicode(length=50), nullable=False),
        sa.Column('payload', sa.UnicodeText(), nullable=True),
        sa.Column('status', sa.Unicode(length=20), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('action_id'),
        sa.ForeignKeyConstraint(['session_id'], ['Agent_Sessions.session_id'], ondelete='CASCADE'),
    )
    op.create_index('IX_Agent_Actions_Log_session_id', 'Agent_Actions_Log', ['session_id'])


def downgrade() -> None:
    op.drop_index('IX_Agent_Actions_Log_session_id', table_name='Agent_Actions_Log')
    op.drop_table('Agent_Actions_Log')
    op.drop_table('Agent_Sessions')
