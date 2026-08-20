from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import require_roles
from app.services import compliance

router = APIRouter(prefix="/api/compliance", tags=["compliance"])

# Broader than the finance-facing integrations roles (ERP/economics): an ISO 31000
# report is a risk-*governance* artifact, read by whoever owns risk process quality
# (RISK_MANAGER, RISK_OFFICER) as well as whoever signs off on it for the board/
# auditors (CFO, ADMIN) — not restricted to finance alone.
_COMPLIANCE_ROLES = ("RISK_MANAGER", "RISK_OFFICER", "CFO", "ADMIN")


@router.get("/iso31000-report", response_model=schemas.ComplianceReportOut)
def get_iso31000_report(
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_COMPLIANCE_ROLES)),
):
    """Read-only, multi-framework compliance report (ISO 31000, Solvency II Pillar II,
    and the Israeli Capital Market Authority's risk-management circular) — risk mapping /
    ownership / control-status, plus each framework's own governance clauses. See
    app/services/compliance.py for how each framework_sections entry's status is derived
    from existing Properties/Asset_Risk_Profiles/Mitigation_Tasks/Users/Role_Permissions/
    Financial_Statements data."""
    return compliance.build_iso31000_report(db)
