from fastapi import APIRouter, Depends, HTTPException

from app import models, schemas
from app.config import settings
from app.database import get_db
from app.dependencies.permissions import require_roles
from app.services import notifications
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

# Same finance+risk-facing role set as the ERP/economics endpoints: alert routing
# includes CFO-relevant thresholds (e.g. geographic exposure), not just operational
# risk data, and triggering a (simulated) dispatch is closer to an admin action than
# a field-worker concern.
_NOTIFICATIONS_ROLES = ("RISK_MANAGER", "CFO", "ADMIN")


def _check_enabled() -> None:
    """Same graceful-degradation convention as routers/ai.py (missing ANTHROPIC_API_KEY)
    and /api/auth/sso/{provider}/login (sso_enabled=False): a clean 503, not a silent
    no-op or a 500."""
    if not settings.notifications_enabled:
        raise HTTPException(status_code=503, detail="שירות ההתראות מושבת בהגדרות המערכת")


@router.get("/preview", response_model=list[schemas.NotificationOut])
def preview_notifications(
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_NOTIFICATIONS_ROLES)),
):
    """Routes the current threshold-crossing alerts (kpi.calculate_alerts) to
    DEFAULT_RECIPIENTS/channels without "sending" anything — see
    services/notifications.build_notifications. Useful for checking who would be
    paged, and over which channel, before actually triggering a dispatch."""
    _check_enabled()
    return notifications.build_notifications(db)


@router.post("/dispatch", response_model=list[schemas.NotificationOut])
def dispatch_notifications(
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_NOTIFICATIONS_ROLES)),
):
    """Routes and "sends" the current threshold-crossing alerts — see
    services/notifications.dispatch_notifications for why sending is simulated
    (logged at WARNING/INFO by severity, status="simulated") rather than hitting a
    real SendGrid/Twilio/FCM provider. Stateless like erp.post_claim_receipts: no
    dispatched-flag, so calling this again re-sends the same still-open alerts."""
    _check_enabled()
    return notifications.dispatch_notifications(db)
