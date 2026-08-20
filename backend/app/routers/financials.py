from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import require_roles
from app.services import financials

router = APIRouter(prefix="/api/financials", tags=["financials"])

# Multi-year trends and the Solvency-style capital report are financial/executive
# disclosures, same audience as the integrations economics endpoints — not the broader
# governance audience of compliance.py (which also includes RISK_OFFICER).
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
