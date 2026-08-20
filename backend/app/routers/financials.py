from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import require_roles
from app.services import financials

router = APIRouter(prefix="/api/financials", tags=["financials"])

# Multi-year trends and the Solvency-style capital report are financial/executive
# disclosures, same audience as the integrations economics endpoints — not the broader
# governance audience of compliance.py (which also includes RISK_OFFICER). Entering a
# statement is the same finance-facing action, so it shares the same role set rather
# than being narrowed to CFO/ADMIN only.
_FINANCIALS_ROLES = ("RISK_MANAGER", "CFO", "ADMIN")


@router.get("/trends", response_model=list[schemas.MultiYearTrendOut])
def get_multi_year_trends(
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_FINANCIALS_ROLES)),
):
    """One row per Financial_Statements year with derived claim-loss/premium totals
    and the ratios a CFO tracks (loss ratio, insurance expense to revenue, etc.). See
    services/financials.py for the full derivation and its documented assumptions."""
    return financials.calculate_multi_year_trends(db)


@router.get("/regulatory-report", response_model=schemas.RegulatoryReportOut)
def get_regulatory_report(
    seed: int | None = None,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_FINANCIALS_ROLES)),
):
    """Capital Market Authority / Solvency II-style disclosure: a Solvency ratio
    (own funds vs. a VaR-based capital requirement), TIV/MFL concentration disclosure,
    and the multi-year financial trend. Read-only. See
    services/financials.py::build_regulatory_report for the full model and its
    documented simplifying assumptions.

    seed is optional, only for a reproducible SCR simulation run (e.g. tests)."""
    return financials.build_regulatory_report(db, seed=seed)


@router.get("/statements", response_model=list[schemas.FinancialStatementOut])
def list_financial_statements(
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_FINANCIALS_ROLES)),
):
    """Raw Financial_Statements rows, most recent year first — the entered data behind
    /trends' derived ratios and figures."""
    return db.scalars(
        select(models.FinancialStatement).order_by(models.FinancialStatement.year.desc())
    ).all()


@router.post("/statements", response_model=schemas.FinancialStatementOut, status_code=201)
def create_financial_statement(
    payload: schemas.FinancialStatementCreate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_FINANCIALS_ROLES)),
):
    """Enters a multi-year financial statement (TODO_SPEC.md §2, "API פיננסי").
    Financial_Statements previously only had a seed.py-inserted rows; this is the
    write path referenced by services/financials.calculate_multi_year_trends /
    build_regulatory_report, which read whatever rows exist here."""
    statement = models.FinancialStatement(**payload.model_dump())
    db.add(statement)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Financial statement for this year already exists")
    db.refresh(statement)
    return statement
