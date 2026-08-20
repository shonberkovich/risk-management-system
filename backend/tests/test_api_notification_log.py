"""Notification_Log audit trail (routers/notifications.py::list_notification_log +
services/notifications.dispatch_notifications, which is the only writer).
See TODO_SPEC.md §1 ("טבלת Notification_Log")."""
from app import models
from tests.conftest import auth_headers


def test_dispatch_writes_notification_log_rows(client, make_user, db):
    admin = make_user(role="ADMIN", email="admin-notiflog@example.com")
    # Whether calculate_alerts finds any threshold-crossing alerts depends on demo
    # data this test doesn't control; seeding a recipient just ensures routing is
    # deterministic for whatever alerts (possibly zero) do get generated — either
    # way, dispatched notifications and log rows must match 1:1.
    db.add(models.NotificationRecipient(
        role="risk_officer", display_name="קצין סיכונים", email="ro@example.com",
        phone="+972-50-111", channels="EMAIL", min_severity="warning", is_active=True,
    ))
    db.commit()

    dispatch_resp = client.post("/api/notifications/dispatch", headers=auth_headers(admin))
    assert dispatch_resp.status_code == 200
    dispatched = dispatch_resp.json()

    log_resp = client.get("/api/notifications/log", headers=auth_headers(admin))
    assert log_resp.status_code == 200
    log_rows = log_resp.json()

    # Every dispatched notification must be reflected in the log, one row each.
    assert len(log_rows) == len(dispatched)
    if dispatched:
        row = log_rows[0]
        assert row["status"] == "simulated"
        assert "sent_at" in row
        assert isinstance(row["property_ids"], list)


def test_notification_log_requires_notifications_role(client, make_user):
    user = make_user(role="FIELD_WORKER", email="field-notiflog@example.com")
    resp = client.get("/api/notifications/log", headers=auth_headers(user))
    assert resp.status_code == 403


def test_notification_log_orders_most_recent_first(client, make_user, db):
    admin = make_user(role="ADMIN", email="admin-notiflog2@example.com")
    from datetime import datetime, timedelta

    older = models.NotificationLog(
        alert_type="incident_concentration", severity="warning", recipient_role="risk_manager",
        recipient_name="מנהל סיכונים", channel="EMAIL", contact="a@example.com", title="ישן",
        message="הודעה ישנה", property_ids="1,2", value=1, threshold=1, status="simulated",
        sent_at=datetime.utcnow() - timedelta(days=1),
    )
    newer = models.NotificationLog(
        alert_type="incident_concentration", severity="critical", recipient_role="cfo",
        recipient_name="CFO", channel="SMS", contact="+972-50-000", title="חדש",
        message="הודעה חדשה", property_ids="3", value=2, threshold=1, status="simulated",
        sent_at=datetime.utcnow(),
    )
    db.add_all([older, newer])
    db.commit()

    resp = client.get("/api/notifications/log", headers=auth_headers(admin))
    assert resp.status_code == 200
    titles = [row["title"] for row in resp.json()]
    assert titles.index("חדש") < titles.index("ישן")
