"""users.role CHECK allows SYSTEM

Revision ID: c7e2a9d4f1b5
Revises: b1c9e4a7d2f8
Create Date: 2026-10-11 00:00:00.000000

TODO_SPEC.md "משימה 20" step 2 introduced a fixed system sender row (role 'SYSTEM',
see services/notifications.py SYSTEM_USER_EMAIL / app/seed.py) without widening the
Users.role CHECK constraint, so both `python -m app.seed` and the notifications
service's lazy `_get_or_create_system_user` failed on SQL Server with a CHECK
violation. The original constraint was unnamed (SQL Server generated a
`CK__Users__role__<hash>` name), so it's looked up by column and dropped with dynamic
SQL, then recreated under the explicit name `CK_Users_role` sql/schema.sql now uses.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c7e2a9d4f1b5'
down_revision: Union[str, Sequence[str], None] = 'b1c9e4a7d2f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_ROLES = "'RISK_MANAGER','CFO','PROPERTY_MANAGER','FIELD_WORKER','ADMIN','RISK_OFFICER','ADJUSTER'"

_DROP_ROLE_CHECKS = """
DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql += N'ALTER TABLE dbo.Users DROP CONSTRAINT ' + QUOTENAME(cc.name) + N';'
FROM sys.check_constraints cc
JOIN sys.columns c ON c.object_id = cc.parent_object_id AND c.column_id = cc.parent_column_id
WHERE cc.parent_object_id = OBJECT_ID('dbo.Users') AND c.name = 'role';
EXEC sp_executesql @sql;
"""


def upgrade() -> None:
    op.execute(_DROP_ROLE_CHECKS)
    op.execute(f"ALTER TABLE dbo.Users ADD CONSTRAINT CK_Users_role CHECK (role IN ({_ROLES},'SYSTEM'))")


def downgrade() -> None:
    # Fails if a SYSTEM row exists — delete it (and the Emails it sent) first.
    op.execute(_DROP_ROLE_CHECKS)
    op.execute(f"ALTER TABLE dbo.Users ADD CONSTRAINT CK_Users_role CHECK (role IN ({_ROLES}))")
