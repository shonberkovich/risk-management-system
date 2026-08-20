"""Notification_Recipients CRUD (routers/notifications.py) and the
services/notifications._load_recipients fallback-to-DEFAULT_RECIPIENTS behavior.
See TODO_SPEC.md §1 ("טבלת נמעני התראות")."""
from app import models
from app.services import notifications
from tests.conftest import auth_headers


def test_load_recipients_falls_back_to_defaults_when_table_empty(db):
    recipients = notifications._load_recipients(db)
    assert recipients == notifications.DEFAULT_RECIPIENTS


def test_load_recipients_reads_active_rows_from_db(db):
    db.add(models.NotificationRecipient(
        recipient_id=1, role="risk_officer", display_name="קצין סיכונים",
        email="ro@example.com", phone="+972-50-111", channels="EMAIL,SMS",
        min_severity="warning", is_active=True,
    ))
    db.add(models.NotificationRecipient(
        recipient_id=2, role="inactive_role", display_name="לא פעיל",
        email="x@example.com", phone="+972-50-222", channels="EMAIL",
        min_severity="warning", is_active=False,
    ))
    db.commit()

    recipients = notifications._load_recipients(db)
    assert len(recipients) == 1
    assert recipients[0].role == "risk_officer"
    assert recipients[0].channels == ("EMAIL", "SMS")


def test_list_recipients_requires_notifications_role(client, make_user):
    user = make_user(role="FIELD_WORKER", email="field-notif@example.com")
    resp = client.get("/api/notifications/recipients", headers=auth_headers(user))
    assert resp.status_code == 403


def test_admin_can_create_update_and_delete_recipient(client, make_user):
    admin = make_user(role="ADMIN", email="admin-notif@example.com")
    headers = auth_headers(admin)

    create_resp = client.post(
        "/api/notifications/recipients",
        headers=headers,
        json={
            "role": "risk_officer",
            "display_name": "קצין סיכונים",
            "email": "ro@example.com",
            "phone": "+972-50-111",
            "channels": ["EMAIL", "PUSH"],
            "min_severity": "warning",
        },
    )
    assert create_resp.status_code == 201
    body = create_resp.json()
    assert body["channels"] == ["EMAIL", "PUSH"]
    recipient_id = body["recipient_id"]

    update_resp = client.patch(
        f"/api/notifications/recipients/{recipient_id}",
        headers=headers,
        json={"min_severity": "critical", "channels": ["SMS"]},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["min_severity"] == "critical"
    assert update_resp.json()["channels"] == ["SMS"]

    list_resp = client.get("/api/notifications/recipients", headers=headers)
    assert any(r["recipient_id"] == recipient_id for r in list_resp.json())

    delete_resp = client.delete(f"/api/notifications/recipients/{recipient_id}", headers=headers)
    assert delete_resp.status_code == 204

    list_after = client.get("/api/notifications/recipients", headers=headers)
    assert all(r["recipient_id"] != recipient_id for r in list_after.json())


def test_non_admin_cannot_create_recipient(client, make_user):
    user = make_user(role="RISK_MANAGER", email="rm-notif@example.com")
    resp = client.post(
        "/api/notifications/recipients",
        headers=auth_headers(user),
        json={
            "role": "risk_officer",
            "display_name": "קצין סיכונים",
            "email": "ro@example.com",
            "phone": "+972-50-111",
            "channels": ["EMAIL"],
        },
    )
    assert resp.status_code == 403
