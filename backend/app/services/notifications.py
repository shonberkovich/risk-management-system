"""Cross-channel alert notification engine. Pure calculation/routing layer, no LLM
calls here (mirrors kpi.py / cashflow.py / retention.py) — and, importantly, no real
Email/SMS/Push delivery either.

The core question this answers: given the threshold-crossing alerts from
kpi.calculate_alerts, who should be told, and over which channel(s)? Real outbound
delivery (an actual SendGrid/Twilio/FCM integration) is explicitly out of scope for
this course demo (see docs/README.md §8, "התראות Push/SMS אוטומטיות על אירועים
קריטיים") — there's no provider account, no credentials in backend/.env, and no
delivery-status webhook handling. Instead, dispatch_notifications() builds the same
routed notification records a real integration would hand off to a provider, and
"sends" them by logging (status "simulated") — demonstrating a working routing/
fan-out mechanism without pretending to be a production paging system.

This mirrors how routers/ai.py degrades gracefully without an ANTHROPIC_API_KEY: the
feature is fully exercised end-to-end, just without an external side effect at the end.
"""
import logging
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.services.kpi import calculate_alerts

logger = logging.getLogger("rmis.notifications")

SEVERITY_RANK = {"critical": 0, "warning": 1}
CHANNELS = ("EMAIL", "SMS", "PUSH")


@dataclass
class Recipient:
    """A notification target. The schema has no Users/contacts table for this yet
    (see docs/README.md §8, RBAC/user directory scoped out), so recipients are a
    fixed, documented configuration here rather than a DB-backed lookup — same
    "simplifying, fixed assumption" pattern as retention.PREMIUM_SURCHARGE_RATE."""
    role: str
    display_name: str
    email: str
    phone: str
    channels: tuple[str, ...]  # subset of CHANNELS this recipient can be reached on
    min_severity: str = "warning"  # lowest alert severity this recipient wants to hear about


# Default routing: the risk manager is operationally closest to the data and wants
# every alert on the widest set of channels; the CFO only cares about the alerts with
# real balance-sheet consequences, so is only paged on "critical" and only by the
# faster/more interruptive channels (EMAIL + SMS, no push app assumed for a CFO).
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


def build_notifications(
    db: Session,
    recipients: list[Recipient] | None = None,
    geo_exposure_threshold_ratio: float | None = None,
    incident_concentration_threshold: int | None = None,
) -> list[dict]:
    """Runs kpi.calculate_alerts (optionally with overridden, configurable thresholds
    — see kpi.calculate_alerts docstring) and fans each alert out to every recipient
    subscribed at that severity, on every channel that recipient supports. Returns one
    notification record per (alert, recipient, channel) combination — not yet "sent",
    just routed; see dispatch_notifications for the simulated-send step.

    recipients defaults to DEFAULT_RECIPIENTS; pass a custom list to test different
    routing configurations without touching the module constant."""
    recipients = DEFAULT_RECIPIENTS if recipients is None else recipients
    alerts = calculate_alerts(db, geo_exposure_threshold_ratio, incident_concentration_threshold)

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


def dispatch_notifications(
    db: Session,
    recipients: list[Recipient] | None = None,
    geo_exposure_threshold_ratio: float | None = None,
    incident_concentration_threshold: int | None = None,
) -> list[dict]:
    """build_notifications, then "sends" each record. Real delivery is out of scope
    (see module docstring), so sending is simulated: each notification is logged at
    WARNING (critical) or INFO (warning) level and returned with status="simulated".
    A real integration would swap the logger.log call below for an actual
    SendGrid/Twilio/FCM API call, keeping build_notifications unchanged."""
    notifications = build_notifications(
        db, recipients, geo_exposure_threshold_ratio, incident_concentration_threshold
    )

    for n in notifications:
        level = logging.WARNING if n["severity"] == "critical" else logging.INFO
        logger.log(
            level,
            "[SIMULATED %s] to %s (%s) via %s: %s — %s",
            n["severity"].upper(), n["recipient_name"], n["contact"], n["channel"], n["title"], n["message"],
        )
        n["status"] = "simulated"

    return notifications
