"""email is_system_email marker

Revision ID: b1c9e4a7d2f8
Revises: 0dd04377c435
Create Date: 2026-08-22 00:00:00.000000

TODO_SPEC.md "משימה 20" step 3 — adds Emails.is_system_email, the visual-distinction
signal for a message created by services/notifications.py's dispatch->internal-email
bridge (see models.Email's docstring for why a dedicated boolean was chosen over
reusing sender_id IS NULL or sender.role). NOT NULL, server_default='0' so every
existing row backfills to "normal email" rather than NULL, matching the column's
Python-side default=False in models.py.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b1c9e4a7d2f8'
down_revision: Union[str, Sequence[str], None] = '0dd04377c435'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('Emails', sa.Column('is_system_email', sa.Boolean(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('Emails', 'is_system_email')
