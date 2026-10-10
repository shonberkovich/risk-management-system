"""timestamp column defaults -> SYSUTCDATETIME()

Revision ID: e4c6a8b0d2f7
Revises: d2b8f4a6c1e3
Create Date: 2026-10-11 00:00:00.000000

Every DateTime column is naive UTC by convention (models.py `_utcnow`, which the ORM
uses for all of them), but ten of sql/schema.sql's DB-side defaults were
SYSDATETIME() — server *local* time — while the newer tables already used
SYSUTCDATETIME(). Those defaults only fire for raw inserts that omit the column,
i.e. app/seed.py, so seeded rows were stamped in local time next to ORM rows in UTC,
and the frontend (which reads these values as UTC) showed them hours off.

Swaps every remaining `(sysdatetime())` default constraint for SYSUTCDATETIME().
Default constraints are auto-named, so they're found by definition with dynamic SQL.
Existing row values are left untouched (a DB holding mixed local/UTC rows can't be
told apart reliably) — reseed (`python -m app.seed`) for clean demo data.
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e4c6a8b0d2f7'
down_revision: Union[str, Sequence[str], None] = 'd2b8f4a6c1e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# The columns whose default this revision changes (for downgrade).
_COLUMNS = [
    ("Users", "created_at"),
    ("Properties", "created_at"),
    ("Properties", "updated_at"),
    ("Incidents", "created_at"),
    ("Incident_Media", "captured_at"),
    ("Claims", "created_at"),
    ("Claim_Reserves", "updated_at"),
    ("Mitigation_Tasks", "created_at"),
    ("Audit_Log", "timestamp"),
    ("Emails", "created_at"),
]


def _swap_default(table: str, column: str, from_sql: str, to_sql: str) -> str:
    return f"""
DECLARE @name sysname, @sql NVARCHAR(400);
SELECT @name = dc.name
FROM sys.default_constraints dc
JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
WHERE dc.parent_object_id = OBJECT_ID('dbo.{table}') AND c.name = '{column}'
  AND LOWER(dc.definition) = '({from_sql.lower()})';
IF @name IS NOT NULL
BEGIN
    SET @sql = N'ALTER TABLE dbo.{table} DROP CONSTRAINT ' + QUOTENAME(@name);
    EXEC sp_executesql @sql;
    ALTER TABLE dbo.{table} ADD DEFAULT {to_sql} FOR [{column}];
END
"""


def upgrade() -> None:
    for table, column in _COLUMNS:
        op.execute(_swap_default(table, column, "sysdatetime()", "SYSUTCDATETIME()"))


def downgrade() -> None:
    for table, column in _COLUMNS:
        op.execute(_swap_default(table, column, "sysutcdatetime()", "SYSDATETIME()"))
