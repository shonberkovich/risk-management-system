"""Audit_Log.action CHECK allows DOWNLOAD

Revision ID: f3b8d2e6a4c1
Revises: e4c6a8b0d2f7
Create Date: 2026-10-12 00:00:00.000000

middleware/audit.py records sensitive attachment downloads (GET
/api/emails/attachments/{id}/signed-url) as action 'DOWNLOAD', but the Audit_Log CHECK
only allowed CREATE/UPDATE/DELETE, so on SQL Server every such row failed the
constraint and was silently rolled back (the SQLite test DB had no CHECK, so the tests
passed). The original constraint was unnamed (SQL Server generated a
`CK__Audit_Log__actio__<hash>` name), so it's looked up by column and dropped with
dynamic SQL, then recreated under the explicit name `CK_Audit_Log_action` that
sql/schema.sql and models.AuditLog now use.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f3b8d2e6a4c1'
down_revision: Union[str, Sequence[str], None] = 'e4c6a8b0d2f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DROP_ACTION_CHECKS = """
DECLARE @sql NVARCHAR(MAX) = N'';
SELECT @sql += N'ALTER TABLE dbo.Audit_Log DROP CONSTRAINT ' + QUOTENAME(cc.name) + N';'
FROM sys.check_constraints cc
JOIN sys.columns c ON c.object_id = cc.parent_object_id AND c.column_id = cc.parent_column_id
WHERE cc.parent_object_id = OBJECT_ID('dbo.Audit_Log') AND c.name = 'action';
EXEC sp_executesql @sql;
"""


def upgrade() -> None:
    op.execute(_DROP_ACTION_CHECKS)
    op.execute(
        "ALTER TABLE dbo.Audit_Log ADD CONSTRAINT CK_Audit_Log_action "
        "CHECK (action IN ('CREATE','UPDATE','DELETE','DOWNLOAD'))"
    )


def downgrade() -> None:
    # Fails while DOWNLOAD rows exist; delete them first.
    op.execute(_DROP_ACTION_CHECKS)
    op.execute(
        "ALTER TABLE dbo.Audit_Log ADD CONSTRAINT CK_Audit_Log_action "
        "CHECK (action IN ('CREATE','UPDATE','DELETE'))"
    )
