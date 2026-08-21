"""merge heads: users_is_active + encrypt_sensitive_fields

TODO_SPEC.md §11, item 3 — `a1c4d8e2f6b0` (Users.is_active) and
`f1a9c7e4b2d3` (encrypt_sensitive_fields) both branched off the same parent,
`e5f7a2c9b3d1` (performance_indexes), leaving two independent heads instead
of one linear chain. `alembic upgrade head` on a fresh/existing DB errors
out ("Multiple head revisions are present") until this is resolved. This is
a no-op merge revision (no schema change) that gives both branches a single
common descendant so `alembic upgrade head` — and the two new migrations
added under TODO_SPEC.md §11 items 1-2 (near_hazmat_site,
resolved_address) — have exactly one head to build on again.

Revision ID: 044aa957cc4e
Revises: a1c4d8e2f6b0, f1a9c7e4b2d3
Create Date: 2026-08-21 13:12:38.666524

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '044aa957cc4e'
down_revision: Union[str, Sequence[str], None] = ('a1c4d8e2f6b0', 'f1a9c7e4b2d3')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
