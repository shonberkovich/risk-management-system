"""Incidents.resolved_address

TODO_SPEC.md §11, item 2 — adds a nullable street-address column to
Incidents, populated by reverse-geocoding `reported_coordinates` through OSM
Nominatim (see app/integrations/gis.py's new `reverse_geocode` function).
Unicode (not String) per CLAUDE.md's Hebrew-text gotcha — Nominatim returns
Hebrew street/city names for Israeli coordinates, and the generic String
type would silently corrupt them to `?` on INSERT via pyodbc even though the
column is NVARCHAR.

Generated via `alembic revision --autogenerate` and then hand-trimmed of the
same cosmetic autogenerate noise described in `668a271b79c2`'s docstring
(unrelated DATETIME2/DateTime and index diffs) — only the real new column
is kept here.

Revision ID: 7c2e4f9a1b83
Revises: 668a271b79c2
Create Date: 2026-08-21

"""
from alembic import op
import sqlalchemy as sa

revision = '7c2e4f9a1b83'
down_revision = '668a271b79c2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'Incidents',
        sa.Column('resolved_address', sa.Unicode(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('Incidents', 'resolved_address')
