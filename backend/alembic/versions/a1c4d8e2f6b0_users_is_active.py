"""Users.is_active

TODO_SPEC.md §2, "ניהול משתמשים (users.py)" — adds an is_active flag so a user can
be disabled (rather than only ever created) via the new write endpoints. Enforced at
login (routers/auth.py) and on every existing token (dependencies/permissions.
get_current_user), so disabling takes effect immediately, not just for future logins.

Revision ID: a1c4d8e2f6b0
Revises: e5f7a2c9b3d1
Create Date: 2026-08-20
"""
from alembic import op
import sqlalchemy as sa

revision = 'a1c4d8e2f6b0'
down_revision = 'e5f7a2c9b3d1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'Users',
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column('Users', 'is_active')
