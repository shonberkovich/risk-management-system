"""Unit tests for app/services/notifications.py routing/dispatch logic, and integration
tests for GET /api/notifications/preview and POST /api/notifications/dispatch
(routers/notifications.py) — previously uncovered pieces of the notifications module
(TODO_SPEC.md §9, "בדיקות Backend"). Notification_Recipients CRUD and Notification_Log
are already covered by test_api_notification_recipients.py / test_api_notification_log.py;
critical-incident dispatch is covered end-to-end by test_api_incidents.py."""
from app import models
from app.services import notifications
from tests.conftest import auth_headers


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
