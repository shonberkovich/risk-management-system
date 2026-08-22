"""Unit tests for app/services/notifications.py routing/dispatch logic, and integration
tests for GET /api/notifications/preview and POST /api/notifications/dispatch
(routers/notifications.py) — previously uncovered pieces of the notifications module
(TODO_SPEC.md §9, "בדיקות Backend"). Notification_Recipients CRUD and Notification_Log
are already covered by test_api_notification_recipients.py / test_api_notification_log.py;
critical-incident dispatch is covered end-to-end by test_api_incidents.py."""
from app import models
from app.services import notifications
from tests.conftest import auth_headers

# TODO_SPEC.md "משימה 20" step 2 tests below (dispatch->internal-email bridge).


def _alert(severity: str, alert_type: str = "geographic_exposure", property_ids: list[int] | None = None) -> dict:
    return {
        "alert_type": alert_type,
        "severity": severity,
        "title": "כותרת בדיקה",
        "message": "הודעת בדיקה",
        "property_ids": property_ids or [1],
        "value": 10.0,
        "threshold": 5.0,
    }


def test_route_alerts_skips_recipients_below_their_min_severity():
    cfo_only_critical = notifications.Recipient(
        role="cfo", display_name="CFO", email="cfo@example.com", phone="+972-50-1",
        channels=("EMAIL", "SMS"), min_severity="critical",
    )
    routed = notifications._route_alerts([_alert("warning")], [cfo_only_critical])
    assert routed == []


def test_route_alerts_fans_out_one_record_per_channel():
    recipient = notifications.Recipient(
        role="risk_manager", display_name="מנהל סיכונים", email="rm@example.com", phone="+972-50-2",
        channels=("EMAIL", "PUSH"), min_severity="warning",
    )
    routed = notifications._route_alerts([_alert("critical")], [recipient])
    assert len(routed) == 2
    channels = {r["channel"] for r in routed}
    assert channels == {"EMAIL", "PUSH"}
    email_record = next(r for r in routed if r["channel"] == "EMAIL")
    assert email_record["contact"] == "rm@example.com"
    sms_or_push = next(r for r in routed if r["channel"] == "PUSH")
    assert sms_or_push["contact"] == "+972-50-2"


def test_route_alerts_sorts_critical_before_warning():
    recipient = notifications.Recipient(
        role="risk_manager", display_name="מנהל סיכונים", email="rm@example.com", phone="+972-50-2",
        channels=("EMAIL",), min_severity="warning",
    )
    routed = notifications._route_alerts([_alert("warning"), _alert("critical")], [recipient])
    assert [r["severity"] for r in routed] == ["critical", "warning"]


def test_build_notifications_uses_default_recipients_when_table_empty(db, make_property, make_risk_profile):
    # Two nearby high-MFL properties trip the geographic_exposure alert so there's
    # something real to route.
    near_a = make_property(latitude=32.000, longitude=34.000, replacement_value=10_000_000)
    near_b = make_property(latitude=32.001, longitude=34.000, replacement_value=10_000_000)
    make_risk_profile(near_a.property_id, mfl_amount=5_000_000)
    make_risk_profile(near_b.property_id, mfl_amount=5_000_000)

    routed = notifications.build_notifications(db, geo_exposure_threshold_ratio=0.1)
    assert routed  # at least one alert got routed
    assert all(r["recipient_role"] in ("risk_manager", "cfo") for r in routed)


def test_dispatch_notifications_persists_log_rows_and_marks_simulated(db, make_property, make_risk_profile):
    db.add(models.NotificationRecipient(
        role="risk_officer", display_name="קצין סיכונים", email="ro@example.com",
        phone="+972-50-111", channels="EMAIL", min_severity="warning", is_active=True,
    ))
    near_a = make_property(latitude=32.000, longitude=34.000, replacement_value=10_000_000)
    near_b = make_property(latitude=32.001, longitude=34.000, replacement_value=10_000_000)
    make_risk_profile(near_a.property_id, mfl_amount=5_000_000)
    make_risk_profile(near_b.property_id, mfl_amount=5_000_000)
    db.commit()

    dispatched = notifications.dispatch_notifications(db, geo_exposure_threshold_ratio=0.1)
    assert dispatched
    assert all(n["status"] == "simulated" for n in dispatched)

    log_rows = db.query(models.NotificationLog).all()
    assert len(log_rows) == len(dispatched)


def test_build_critical_incident_alert_shape(db, make_property, make_incident):
    prop = make_property()
    incident = make_incident(prop.property_id, severity_level="CRITICAL", hazard_type="FIRE")

    alert = notifications.build_critical_incident_alert(incident)
    assert alert["alert_type"] == "critical_incident"
    assert alert["severity"] == "critical"
    assert alert["property_ids"] == [prop.property_id]
    assert incident.incident_code in alert["title"]


def test_dispatch_critical_incident_alert_routes_and_logs(db, make_property, make_incident):
    db.add(models.NotificationRecipient(
        role="risk_officer", display_name="קצין סיכונים", email="ro@example.com",
        phone="+972-50-111", channels="EMAIL,PUSH", min_severity="warning", is_active=True,
    ))
    prop = make_property()
    incident = make_incident(prop.property_id, severity_level="CRITICAL")
    db.commit()

    dispatched = notifications.dispatch_critical_incident_alert(db, incident)
    assert len(dispatched) == 2  # one recipient x two channels
    assert all(n["alert_type"] == "critical_incident" for n in dispatched)


def test_preview_notifications_requires_notifications_role(client, make_user):
    worker = make_user(role="FIELD_WORKER")
    resp = client.get("/api/notifications/preview", headers=auth_headers(worker))
    assert resp.status_code == 403


def test_preview_notifications_does_not_write_log_rows(client, make_user, db):
    manager = make_user(role="RISK_MANAGER")
    resp = client.get("/api/notifications/preview", headers=auth_headers(manager))
    assert resp.status_code == 200
    assert db.query(models.NotificationLog).count() == 0


def test_preview_returns_503_when_notifications_disabled(client, make_user, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "notifications_enabled", False)

    manager = make_user(role="RISK_MANAGER")
    resp = client.get("/api/notifications/preview", headers=auth_headers(manager))
    assert resp.status_code == 503


def test_dispatch_returns_503_when_notifications_disabled(client, make_user, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "notifications_enabled", False)

    admin = make_user(role="ADMIN")
    resp = client.post("/api/notifications/dispatch", headers=auth_headers(admin))
    assert resp.status_code == 503


def test_dispatch_notifications_forbidden_for_field_worker(client, make_user):
    worker = make_user(role="FIELD_WORKER")
    resp = client.post("/api/notifications/dispatch", headers=auth_headers(worker))
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# TODO_SPEC.md "משימה 20" step 2 — dispatch->internal-email bridge
# ---------------------------------------------------------------------------


def test_dispatch_notifications_creates_internal_email_for_matching_internal_recipient(
    db, make_user, make_property, make_risk_profile
):
    """A Notification_Recipients row whose `email` matches a real Users.email row is
    "internal" — the EMAIL-channel notification must also land as a real Email in
    that user's own INBOX, on top of the unchanged simulated-log/Notification_Log
    behavior (see next test)."""
    officer = make_user(role="RISK_OFFICER", email="ro@example.com")
    db.add(models.NotificationRecipient(
        role="risk_officer", display_name="קצין סיכונים", email="ro@example.com",
        phone="+972-50-111", channels="EMAIL", min_severity="warning", is_active=True,
    ))
    near_a = make_property(latitude=32.000, longitude=34.000, replacement_value=10_000_000)
    near_b = make_property(latitude=32.001, longitude=34.000, replacement_value=10_000_000)
    make_risk_profile(near_a.property_id, mfl_amount=5_000_000)
    make_risk_profile(near_b.property_id, mfl_amount=5_000_000)
    db.commit()

    dispatched = notifications.dispatch_notifications(db, geo_exposure_threshold_ratio=0.1)
    assert dispatched

    recipient_rows = (
        db.query(models.EmailRecipient)
        .filter_by(user_id=officer.user_id, folder="INBOX")
        .all()
    )
    assert len(recipient_rows) == 1
    email = recipient_rows[0].email
    assert email.is_system_email is True
    assert email.subject == dispatched[0]["title"]
    assert email.sender.email == notifications.SYSTEM_USER_EMAIL
    assert email.sender.role == "SYSTEM"

    # The system sender can never log in.
    assert email.sender.password_hash is None
    assert email.sender.is_active is False


def test_dispatch_notifications_skips_internal_email_for_unmatched_recipient(
    db, make_property, make_risk_profile
):
    """DEFAULT_RECIPIENTS' example.local addresses (and any Notification_Recipients
    row whose email doesn't match a real Users row) must never trigger the bridge —
    the simulated-log/Notification_Log behavior alone still covers them, exactly as
    before this feature existed."""
    near_a = make_property(latitude=32.000, longitude=34.000, replacement_value=10_000_000)
    near_b = make_property(latitude=32.001, longitude=34.000, replacement_value=10_000_000)
    make_risk_profile(near_a.property_id, mfl_amount=5_000_000)
    make_risk_profile(near_b.property_id, mfl_amount=5_000_000)
    db.commit()

    dispatched = notifications.dispatch_notifications(db, geo_exposure_threshold_ratio=0.1)
    assert dispatched
    assert all(n["status"] == "simulated" for n in dispatched)  # unchanged existing behavior

    assert db.query(models.Email).count() == 0
    assert db.query(models.User).filter_by(email=notifications.SYSTEM_USER_EMAIL).count() == 0


def test_dispatch_notifications_still_writes_notification_log_when_bridge_fires(
    db, make_user, make_property, make_risk_profile
):
    """The internal-email bridge is additive: NotificationLog rows and the
    status="simulated" result are still produced exactly as before, even for a
    notification that also gets bridged into a real inbox."""
    make_user(role="RISK_OFFICER", email="ro2@example.com")
    db.add(models.NotificationRecipient(
        role="risk_officer", display_name="קצין סיכונים", email="ro2@example.com",
        phone="+972-50-112", channels="EMAIL", min_severity="warning", is_active=True,
    ))
    near_a = make_property(latitude=32.000, longitude=34.000, replacement_value=10_000_000)
    near_b = make_property(latitude=32.001, longitude=34.000, replacement_value=10_000_000)
    make_risk_profile(near_a.property_id, mfl_amount=5_000_000)
    make_risk_profile(near_b.property_id, mfl_amount=5_000_000)
    db.commit()

    dispatched = notifications.dispatch_notifications(db, geo_exposure_threshold_ratio=0.1)
    assert all(n["status"] == "simulated" for n in dispatched)
    assert db.query(models.NotificationLog).count() == len(dispatched)
    assert db.query(models.Email).count() >= 1  # the bridge also fired


def test_bridge_only_fires_for_email_channel_not_sms_or_push(db, make_user, make_property, make_incident):
    """A recipient subscribed on multiple channels for the same alert must get at
    most one bridged internal Email — never a duplicate per channel."""
    officer = make_user(role="RISK_OFFICER", email="ro3@example.com")
    db.add(models.NotificationRecipient(
        role="risk_officer", display_name="קצין סיכונים", email="ro3@example.com",
        phone="+972-50-113", channels="EMAIL,SMS,PUSH", min_severity="warning", is_active=True,
    ))
    prop = make_property()
    incident = make_incident(prop.property_id, severity_level="CRITICAL")
    db.commit()

    dispatched = notifications.dispatch_critical_incident_alert(db, incident)
    assert len(dispatched) == 3  # one recipient x three channels, unchanged routing behavior

    recipient_rows = db.query(models.EmailRecipient).filter_by(user_id=officer.user_id, folder="INBOX").all()
    assert len(recipient_rows) == 1
    assert recipient_rows[0].email.is_system_email is True


def test_dispatch_critical_incident_alert_creates_internal_email(db, make_user, make_property, make_incident):
    officer = make_user(role="RISK_OFFICER", email="ro4@example.com")
    db.add(models.NotificationRecipient(
        role="risk_officer", display_name="קצין סיכונים", email="ro4@example.com",
        phone="+972-50-114", channels="EMAIL", min_severity="warning", is_active=True,
    ))
    prop = make_property()
    incident = make_incident(prop.property_id, severity_level="CRITICAL", hazard_type="FIRE")
    db.commit()

    notifications.dispatch_critical_incident_alert(db, incident)

    recipient_rows = db.query(models.EmailRecipient).filter_by(user_id=officer.user_id, folder="INBOX").all()
    assert len(recipient_rows) == 1
    email = recipient_rows[0].email
    assert email.is_system_email is True
    assert incident.incident_code in email.subject


def test_system_user_is_created_lazily_once_and_reused(db, make_user, make_property, make_risk_profile):
    officer = make_user(role="RISK_OFFICER", email="ro5@example.com")
    db.add(models.NotificationRecipient(
        role="risk_officer", display_name="קצין סיכונים", email="ro5@example.com",
        phone="+972-50-115", channels="EMAIL", min_severity="warning", is_active=True,
    ))
    near_a = make_property(latitude=32.000, longitude=34.000, replacement_value=10_000_000)
    near_b = make_property(latitude=32.001, longitude=34.000, replacement_value=10_000_000)
    make_risk_profile(near_a.property_id, mfl_amount=5_000_000)
    make_risk_profile(near_b.property_id, mfl_amount=5_000_000)
    db.commit()

    notifications.dispatch_notifications(db, geo_exposure_threshold_ratio=0.1)
    notifications.dispatch_notifications(db, geo_exposure_threshold_ratio=0.1)

    system_users = db.query(models.User).filter_by(email=notifications.SYSTEM_USER_EMAIL).all()
    assert len(system_users) == 1


def test_bridge_never_emails_the_system_user_itself(db, make_property, make_risk_profile):
    """If a Notification_Recipients row's email happens to equal the system
    sender's own address, the bridge must not try to send the system user an
    email from itself."""
    system_user = notifications._get_or_create_system_user(db)
    db.add(models.NotificationRecipient(
        role="risk_officer", display_name="מערכת", email=system_user.email,
        phone="+972-50-116", channels="EMAIL", min_severity="warning", is_active=True,
    ))
    near_a = make_property(latitude=32.000, longitude=34.000, replacement_value=10_000_000)
    near_b = make_property(latitude=32.001, longitude=34.000, replacement_value=10_000_000)
    make_risk_profile(near_a.property_id, mfl_amount=5_000_000)
    make_risk_profile(near_b.property_id, mfl_amount=5_000_000)
    db.commit()

    notifications.dispatch_notifications(db, geo_exposure_threshold_ratio=0.1)

    assert db.query(models.Email).count() == 0
