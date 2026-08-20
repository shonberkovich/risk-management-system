"""financial_statements: full balance sheet fields

Revision ID: 8f2a4c6e1d09
Revises: 5d5363142853
Create Date: 2026-08-20 21:00:00.000000

Adds the balance-sheet/P&L fields Financial_Statements was missing for a real
multi-year balance-sheet analysis (TODO_SPEC.md §1): total_liabilities and
total_equity (balance sheet), gross_profit and operating_profit (P&L), on top of
the existing total_assets/revenue/net_income/insurance_expense. All four are
nullable so existing rows (and this migration itself) don't need backfill data —
see models.py's FinancialStatement docstring comment for how financials.py uses
total_equity once populated.

Written by hand rather than via `alembic revision --autogenerate` (no live DB in
this environment to diff against) — mirrors the ADD COLUMN shape already applied
by hand to Financial_Statements in sql/schema.sql.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '8f2a4c6e1d09'
down_revision: Union[str, Sequence[str], None] = '5d5363142853'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('Financial_Statements', schema=None) as batch_op:
        batch_op.add_column(sa.Column('total_liabilities', sa.Numeric(18, 2), nullable=True))
        batch_op.add_column(sa.Column('total_equity', sa.Numeric(18, 2), nullable=True))
        batch_op.add_column(sa.Column('gross_profit', sa.Numeric(18, 2), nullable=True))
        batch_op.add_column(sa.Column('operating_profit', sa.Numeric(18, 2), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('Financial_Statements', schema=None) as batch_op:
        batch_op.drop_column('operating_profit')
        batch_op.drop_column('gross_profit')
        batch_op.drop_column('total_equity')
        batch_op.drop_column('total_liabilities')
