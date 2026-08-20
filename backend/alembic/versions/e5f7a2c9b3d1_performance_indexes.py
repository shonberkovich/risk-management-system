"""Performance indexes: FK indexes + composite index gaps

TODO_SPEC.md §1, "אינדקסים לביצועים". Adds indexes on previously-unindexed FK
columns (Properties.primary_manager_id, Policy_Assets.property_id standalone,
Incidents.reported_by_user_id, Incident_Media.incident_id,
Mitigation_Tasks.assigned_to_user_id). No spatial (SPATIAL INDEX/GEOGRAPHY) or
further composite index changes: see the comments added next to
IX_Properties_Coordinates and IX_ClaimPayments_ClaimDate in schema.sql for why
those two parts of the TODO item were already satisfied by prior work
(IX_Properties_Coordinates, IX_Incidents_StatusHazard, IX_ClaimPayments_ClaimDate).

Revision ID: e5f7a2c9b3d1
Revises: d4e1b298a715
Create Date: 2026-08-20
"""
from alembic import op

revision = 'e5f7a2c9b3d1'
down_revision = 'd4e1b298a715'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index('IX_Properties_PrimaryManager', 'Properties', ['primary_manager_id'])
    op.create_index('IX_PolicyAssets_Property', 'Policy_Assets', ['property_id'])
    op.create_index('IX_Incidents_ReportedBy', 'Incidents', ['reported_by_user_id'])
    op.create_index('IX_IncidentMedia_Incident', 'Incident_Media', ['incident_id'])
    op.create_index('IX_Mitigation_AssignedTo', 'Mitigation_Tasks', ['assigned_to_user_id'])


def downgrade() -> None:
    op.drop_index('IX_Mitigation_AssignedTo', table_name='Mitigation_Tasks')
    op.drop_index('IX_IncidentMedia_Incident', table_name='Incident_Media')
    op.drop_index('IX_Incidents_ReportedBy', table_name='Incidents')
    op.drop_index('IX_PolicyAssets_Property', table_name='Policy_Assets')
    op.drop_index('IX_Properties_PrimaryManager', table_name='Properties')
