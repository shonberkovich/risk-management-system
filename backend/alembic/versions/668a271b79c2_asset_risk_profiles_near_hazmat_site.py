"""Asset_Risk_Profiles.near_hazmat_site

TODO_SPEC.md §11, item 1 — adds a proximity-to-hazmat-site indicator to a
property's risk profile, so it can feed a fire-risk-score penalty (see
app/integrations/environmental.py for the data.gov.il hazmat-sites lookup;
the §13 automation that actually applies the penalty is out of this branch's
scope). Same shape as `a1c4d8e2f6b0` (Users.is_active): NOT NULL with a
server default so existing rows don't need a backfill.

Generated via `alembic revision --autogenerate` and then hand-trimmed: the
raw autogenerate diff also re-flagged the fixed set of cosmetic differences
documented in CLAUDE.md (DATETIME2 vs DateTime rendering across many
unrelated tables, several indexes schema.sql creates that aren't mirrored
as Index(...) in models.py) — none of that is a real model change, so only
the actual new column is kept here.

Revision ID: 668a271b79c2
Revises: 044aa957cc4e
Create Date: 2026-08-21

"""
from alembic import op
import sqlalchemy as sa

revision = '668a271b79c2'
down_revision = '044aa957cc4e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'Asset_Risk_Profiles',
        sa.Column('near_hazmat_site', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column('Asset_Risk_Profiles', 'near_hazmat_site')
