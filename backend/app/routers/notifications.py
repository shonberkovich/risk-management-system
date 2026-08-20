from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.config import settings
from app.database import get_db
from app.dependencies.permissions import require_roles
from app.services import notifications

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

# Same finance+risk-facing role set as the ERP/economics endpoints: alert routing
# includes CFO-relevant thresholds (e.g. geographic exposure), not just operational
# risk data, and triggering a (simulated) dispatch is closer to an admin action than
# a field-worker concern.
_NOTIFICATIONS_ROLES = ("RISK_MANAGER", "CFO", "ADMIN")

# Managing *who* gets paged (Notification_Recipients) is an administrative action,
# narrower than previewing/dispatching alerts — ADMIN only, same reasoning as
# routers/users.py write endpoints.
_RECIPIENTS_WRITE_ROLES = ("ADMIN",)


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


def _recipient_to_out(recipient: models.NotificationRecipient) -> schemas.NotificationRecipientOut:
    return schemas.NotificationRecipientOut(
        recipient_id=recipient.recipient_id,
        role=recipient.role,
        display_name=recipient.display_name,
        email=recipient.email,
        phone=recipient.phone,
        channels=[c.strip() for c in recipient.channels.split(",") if c.strip()],
        min_severity=recipient.min_severity,
        is_active=recipient.is_active,
    )


@router.get("/recipients", response_model=list[schemas.NotificationRecipientOut])
def list_recipients(
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_NOTIFICATIONS_ROLES)),
):
    """Who alerts are currently routed to (services/notifications._load_recipients
    reads the same table). Read access mirrors preview/dispatch; only creating/editing
    recipients is ADMIN-only, see _RECIPIENTS_WRITE_ROLES."""
    recipients = db.scalars(
        select(models.NotificationRecipient).order_by(models.NotificationRecipient.recipient_id)
    ).all()
    return [_recipient_to_out(r) for r in recipients]


@router.post("/recipients", response_model=schemas.NotificationRecipientOut, status_code=201)
def create_recipient(
    payload: schemas.NotificationRecipientCreate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_RECIPIENTS_WRITE_ROLES)),
):
    recipient = models.NotificationRecipient(
        role=payload.role,
        display_name=payload.display_name,
        email=payload.email,
        phone=payload.phone,
        channels=",".join(payload.channels),
        min_severity=payload.min_severity,
        is_active=payload.is_active,
    )
    db.add(recipient)
    db.commit()
    db.refresh(recipient)
    return _recipient_to_out(recipient)


@router.patch("/recipients/{recipient_id}", response_model=schemas.NotificationRecipientOut)
def update_recipient(
    recipient_id: int,
    payload: schemas.NotificationRecipientUpdate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_RECIPIENTS_WRITE_ROLES)),
):
    recipient = db.get(models.NotificationRecipient, recipient_id)
    if not recipient:
        raise HTTPException(404, "Notification recipient not found")

    updates = payload.model_dump(exclude_unset=True)
    if "channels" in updates:
        updates["channels"] = ",".join(updates["channels"])
    for field, value in updates.items():
        setattr(recipient, field, value)

    db.commit()
    db.refresh(recipient)
    return _recipient_to_out(recipient)


@router.delete("/recipients/{recipient_id}", status_code=204)
def delete_recipient(
    recipient_id: int,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_RECIPIENTS_WRITE_ROLES)),
):
    recipient = db.get(models.NotificationRecipient, recipient_id)
    if not recipient:
        raise HTTPException(404, "Notification recipient not found")
    db.delete(recipient)
    db.commit()
