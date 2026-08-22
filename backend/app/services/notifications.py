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

TODO_SPEC.md "משימה 20" step 2 — dispatch->internal-email bridge: real outbound
delivery is still out of scope (see above), but *internal* delivery no longer is —
this app now has a real internal mailbox (services/email.py). So alongside the
simulated log + Notification_Log row every dispatched notification already got
(_send_and_log, unchanged), `_bridge_to_internal_inbox` below additionally creates a
genuine `Email`/`Email_Recipients` row in an *internal* recipient's own INBOX for
every EMAIL-channel notification, so a risk_manager/cfo/etc. who is also a real
Users row actually sees the alert show up in Emails.tsx, not just in a log file only
an ops engineer would ever tail. "Internal" here means "this Recipient's `email`
matches an existing `Users.email` row" — routing still comes entirely from
Notification_Recipients/DEFAULT_RECIPIENTS as before; this only asks, for each
already-routed EMAIL notification, "does that address happen to belong to a real
system user?" and if so, mirrors it into their inbox too. A recipient whose email
doesn't match any User (an external distribution address, or the DEFAULT_RECIPIENTS
fallback's example.local addresses) simply never gets the internal-email step —
still fully covered by the simulated-log/Notification_Log behavior alone, unchanged.

Only the EMAIL channel is bridged (never SMS/PUSH) — a single alert fanned out to a
recipient on multiple channels must not produce multiple duplicate inbox emails for
the one alert; EMAIL is the one channel an internal inbox message is a faithful
stand-in for.

Privacy (TODO_SPEC.md "משימה 20" step 5): this bridge sends through
`services/email.send_email` — the exact same function, same `Email_Recipients`
fan-out, same RBAC (`routers/emails.py`'s mailbox-ownership checks) as any
person-to-person email. There is no direct DB write here that hands a recipient's
inbox contents to anyone who wasn't already an addressed recipient; the sender is a
fixed, non-interactive "system" `Users` row (see `_get_or_create_system_user`) that
can never log in (NULL password_hash), not a real person's account, and the message
itself only ever contains the same title/message text already written to
Notification_Log — never any other user's private mail content.
"""
import logging
from dataclasses import dataclass, field
from datetime import datetime
from html import escape

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.schemas import EmailCreate
from app.services import email as email_service
from app.services.kpi import calculate_alerts

logger = logging.getLogger("rmis.notifications")

# TODO_SPEC.md "משימה 20" step 2 — the fixed sender for every system-generated
# internal email this bridge creates. Matched by email against Users (not by a
# hardcoded id), so it's found whether it came from app/seed.py's demo data or was
# lazily created by `_get_or_create_system_user` below on a DB that was never
# reseeded after this feature landed (mirrors `_load_recipients`'s own
# DEFAULT_RECIPIENTS fallback posture: never assume a fresh/test DB was seeded).
SYSTEM_USER_EMAIL = "system@rmis.local"
SYSTEM_USER_NAME = "מערכת RMIS"

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


def _get_or_create_system_user(db: Session) -> models.User:
    """Looks up the fixed system sender by `SYSTEM_USER_EMAIL`, creating it if this
    DB was never reseeded after TODO_SPEC.md "משימה 20" landed (see module
    docstring / app/seed.py's own insert of this same row for the normal case).
    `password_hash=None`/`is_active=False` so this row can never actually log in
    (services.auth.verify_password treats a NULL hash as "never matches") — it
    exists only to be `Email.sender_id` for system-generated mail, never a real
    session."""
    user = db.scalar(select(models.User).where(models.User.email == SYSTEM_USER_EMAIL))
    if user is not None:
        return user
    user = models.User(
        full_name=SYSTEM_USER_NAME,
        email=SYSTEM_USER_EMAIL,
        role="SYSTEM",
        password_hash=None,
        is_active=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _internal_user_for_contact(db: Session, contact: str) -> models.User | None:
    """Is `contact` (a routed notification's EMAIL-channel address) an internal
    system user? Matched against `Users.email` — see module docstring for why this,
    not a `user_id` on `Recipient`/`NotificationRecipient`, is what "internal"
    means here (those rows are role/email/phone routing config, same shape whether
    or not the address happens to also be a real employee's login)."""
    return db.scalar(select(models.User).where(models.User.email == contact))


def _bridge_to_internal_inbox(db: Session, notifications: list[dict]) -> None:
    """TODO_SPEC.md "משימה 20" step 2 — for every already-"sent" (simulated)
    EMAIL-channel notification whose `contact` matches a real internal `Users.email`,
    also creates a genuine internal `Email` in that user's INBOX via
    `services/email.send_email` (see module docstring for the privacy rationale).
    Purely additive: never mutates or skips the simulated-log/Notification_Log
    behavior `_send_and_log` already performed above this call — a notification
    with no matching internal user is simply left as simulated-log-only, exactly
    as before this feature existed.

    The system sender is looked up/created lazily (only once real work is needed,
    not on every dispatch call that happens to route zero EMAIL notifications) so
    a DB that never triggers this path never gains an extra Users row for nothing."""
    system_user: models.User | None = None
    for n in notifications:
        if n["channel"] != "EMAIL":
            continue
        recipient_user = _internal_user_for_contact(db, n["contact"])
        if recipient_user is None:
            continue
        if system_user is None:
            system_user = _get_or_create_system_user(db)
        if recipient_user.user_id == system_user.user_id:
            continue  # never mail the system account itself

        body_html = f"<p>{escape(n['message'])}</p>"
        email_service.send_email(
            db,
            system_user.user_id,
            EmailCreate(to=[recipient_user.user_id], subject=n["title"], body_html=body_html),
            is_system_email=True,
        )


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

    # TODO_SPEC.md "משימה 20" step 2 — additive, after the simulated-log/
    # Notification_Log behavior above (unchanged) has already committed. See
    # `_bridge_to_internal_inbox`'s own docstring.
    _bridge_to_internal_inbox(db, notifications)

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
