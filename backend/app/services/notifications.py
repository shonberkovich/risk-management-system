"""Cross-channel alert notification engine. Pure calculation/routing layer, no LLM
calls here (mirrors kpi.py / cashflow.py / retention.py) — and, importantly, no real
Email/SMS/Push delivery either.

The core question this answers: given an alert — either a threshold-crossing one from
kpi.calculate_alerts, or a single CRITICAL-incident alert (build_critical_incident_alert,
TODO_SPEC.md §2 "אוטומציית שטח") — who should be told, and over which channel(s)? Real
outbound delivery (an actual SendGrid/Twilio/FCM integration) is explicitly out of
scope for this course demo — there's no provider account, no credentials in
backend/.env, and no delivery-status webhook handling. Instead, dispatch_notifications()
/dispatch_critical_incident_alert() build the same routed notification records a real
integration would hand off to a provider, and "send" them by logging (status
"simulated") — demonstrating a working routing/fan-out mechanism without pretending to
be a production paging system. The *triggering* (when a dispatch happens — on a manual
POST /api/notifications/dispatch call, or automatically on a CRITICAL incident) is real;
only the last-mile delivery is simulated.

This mirrors how routers/ai.py degrades gracefully without an ANTHROPIC_API_KEY: the
feature is fully exercised end-to-end, just without an external side effect at the end.
"""
import logging
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.services.kpi import calculate_alerts

logger = logging.getLogger("rmis.notifications")

SEVERITY_RANK = {"critical": 0, "warning": 1}
CHANNELS = ("EMAIL", "SMS", "PUSH")


@dataclass
class Recipient:
    """A notification target. Backed by the Notification_Recipients table
    (models.NotificationRecipient) since TODO_SPEC.md §1 — this dataclass is the
    in-memory shape build_notifications routes against, kept separate from the ORM
    model so the routing logic below doesn't care whether a Recipient came from the
    DB or (as a fallback, see _load_recipients) DEFAULT_RECIPIENTS."""
    role: str
    display_name: str
    email: str
    phone: str
    channels: tuple[str, ...]  # subset of CHANNELS this recipient can be reached on
    min_severity: str = "warning"  # lowest alert severity this recipient wants to hear about


# Fallback routing, used only if Notification_Recipients has no active rows (e.g. a
# fresh DB before seeding, or a unit test that doesn't seed one). Mirrors what used to
# be the only routing config before it moved to the DB: the risk manager is
# operationally closest to the data and wants every alert on the widest set of
# channels; the CFO only cares about alerts with real balance-sheet consequences, so
# is only paged on "critical" and only by the faster/more interruptive channels
# (EMAIL + SMS, no push app assumed for a CFO).
DEFAULT_RECIPIENTS: list[Recipient] = [
    Recipient(
        role="risk_manager",
        display_name="מנהל הסיכונים",
        email="risk.manager@example-rmis.local",
        phone="+972-50-000-0001",
        channels=("EMAIL", "PUSH"),
        min_severity="warning",
    ),
    Recipient(
        role="cfo",
        display_name="סמנכ\"ל הכספים (CFO)",
        email="cfo@example-rmis.local",
        phone="+972-50-000-0002",
        channels=("EMAIL", "SMS"),
        min_severity="critical",
    ),
]


def _load_recipients(db: Session) -> list[Recipient]:
    """Active rows from Notification_Recipients, converted to Recipient dataclasses
    (channels parsed from the stored "EMAIL,PUSH"-style comma-separated string).
    Falls back to DEFAULT_RECIPIENTS if the table has no active rows, so an unseeded
    DB (or a test using an in-memory one) still routes alerts somewhere sensible."""
    rows = db.scalars(
        select(models.NotificationRecipient).where(models.NotificationRecipient.is_active == True)  # noqa: E712
    ).all()
    if not rows:
        return DEFAULT_RECIPIENTS
    return [
        Recipient(
            role=row.role,
            display_name=row.display_name,
            email=row.email,
            phone=row.phone,
            channels=tuple(c.strip() for c in row.channels.split(",") if c.strip()),
            min_severity=row.min_severity,
        )
        for row in rows
    ]


def _route_alerts(alerts: list[dict], recipients: list[Recipient]) -> list[dict]:
    """Fans a list of already-computed alerts out to every recipient subscribed at
    that severity, on every channel that recipient supports. Returns one notification
    record per (alert, recipient, channel) combination — not yet "sent", just routed.
    Shared by build_notifications (aggregate threshold alerts from kpi.calculate_alerts)
    and dispatch_critical_incident_alert (a single per-incident alert) so both go
    through the same routing rules."""
    notifications: list[dict] = []
    for alert in alerts:
        for recipient in recipients:
            if SEVERITY_RANK[alert["severity"]] > SEVERITY_RANK[recipient.min_severity]:
                continue  # alert too low-severity for this recipient's subscription
            for channel in recipient.channels:
                contact = recipient.email if channel in ("EMAIL",) else recipient.phone
                notifications.append({
                    "recipient_role": recipient.role,
                    "recipient_name": recipient.display_name,
                    "channel": channel,
                    "contact": contact,
                    "alert_type": alert["alert_type"],
                    "severity": alert["severity"],
                    "title": alert["title"],
                    "message": alert["message"],
                    "property_ids": alert["property_ids"],
                    "value": alert["value"],
                    "threshold": alert["threshold"],
                })

    notifications.sort(key=lambda n: SEVERITY_RANK[n["severity"]])
    return notifications


def build_notifications(
    db: Session,
    recipients: list[Recipient] | None = None,
    geo_exposure_threshold_ratio: float | None = None,
    incident_concentration_threshold: int | None = None,
) -> list[dict]:
    """Runs kpi.calculate_alerts (optionally with overridden, configurable thresholds
    — see kpi.calculate_alerts docstring) and routes each alert via _route_alerts.
    Not yet "sent", just routed; see dispatch_notifications for the simulated-send
    step.

    recipients defaults to the active Notification_Recipients rows (via
    _load_recipients); pass a custom list to test different routing configurations
    without touching the DB."""
    recipients = _load_recipients(db) if recipients is None else recipients
    alerts = calculate_alerts(db, geo_exposure_threshold_ratio, incident_concentration_threshold)
    return _route_alerts(alerts, recipients)


def _send_and_log(db: Session, notifications: list[dict]) -> list[dict]:
    """"Sends" each already-routed notification record. Real delivery is out of scope
    (see module docstring), so sending is simulated: each notification is logged at
    WARNING (critical) or INFO (warning) level and returned with status="simulated".
    A real integration would swap the logger.log call below for an actual
    SendGrid/Twilio/FCM API call, keeping the routing step unchanged.

    Every "sent" record is also persisted to Notification_Log (models.NotificationLog)
    as an audit trail — see TODO_SPEC.md §1, "טבלת Notification_Log" — independent of
    the in-process `logger.log` call above, which is not queryable after the process
    exits. Shared by dispatch_notifications and dispatch_critical_incident_alert."""
    sent_at = datetime.utcnow()
    for n in notifications:
        level = logging.WARNING if n["severity"] == "critical" else logging.INFO
        logger.log(
            level,
            "[SIMULATED %s] to %s (%s) via %s: %s — %s",
            n["severity"].upper(), n["recipient_name"], n["contact"], n["channel"], n["title"], n["message"],
        )
        n["status"] = "simulated"
        db.add(models.NotificationLog(
            alert_type=n["alert_type"],
            severity=n["severity"],
            recipient_role=n["recipient_role"],
            recipient_name=n["recipient_name"],
            channel=n["channel"],
            contact=n["contact"],
            title=n["title"],
            message=n["message"],
            property_ids=",".join(str(pid) for pid in n["property_ids"]),
            value=n["value"],
            threshold=n["threshold"],
            status=n["status"],
            sent_at=sent_at,
        ))
    if notifications:
        db.commit()

    return notifications


def dispatch_notifications(
    db: Session,
    recipients: list[Recipient] | None = None,
    geo_exposure_threshold_ratio: float | None = None,
    incident_concentration_threshold: int | None = None,
) -> list[dict]:
    """build_notifications, then _send_and_log."""
    notifications = build_notifications(
        db, recipients, geo_exposure_threshold_ratio, incident_concentration_threshold
    )
    return _send_and_log(db, notifications)


def build_critical_incident_alert(incident: models.Incident) -> dict:
    """A single alert dict (same shape as kpi.calculate_alerts' entries) for one
    newly-submitted CRITICAL-severity incident — TODO_SPEC.md §2, "אוטומציית שטח
    (ERP & Alerts)": alongside the auto-opened ERP maintenance ticket/mitigation task
    (routers/incidents.py::_trigger_critical_incident_ticket), a CRITICAL incident
    should also page the on-call recipients immediately, not wait for the next
    aggregate-threshold dispatch (geographic_exposure/incident_concentration)."""
    return {
        "alert_type": "critical_incident",
        "severity": "critical",
        "title": f'אירוע קריטי דווח: {incident.incident_code}',
        "message": f'אירוע {incident.hazard_type} בחומרה CRITICAL דווח בנכס #{incident.property_id} '
                   f'(קוד אירוע {incident.incident_code}). נדרש טיפול מיידי.',
        "property_ids": [incident.property_id],
        "value": 1.0,
        "threshold": 1.0,
    }


def dispatch_critical_incident_alert(
    db: Session,
    incident: models.Incident,
    recipients: list[Recipient] | None = None,
) -> list[dict]:
    """Routes+"sends" (see module docstring) a single critical_incident alert for
    `incident` to the active Notification_Recipients — the Push/SMS side of
    TODO_SPEC.md §2 "אוטומציית שטח (ERP & Alerts)". Caller
    (routers/incidents.py::_trigger_critical_incident_ticket) is responsible for
    checking settings.notifications_enabled first and for the incident already being
    committed (has a property_id/incident_code)."""
    recipients = _load_recipients(db) if recipients is None else recipients
    notifications = _route_alerts([build_critical_incident_alert(incident)], recipients)
    return _send_and_log(db, notifications)
