"""Integration tests: POST/GET/PATCH /api/incidents against a real FastAPI TestClient
(routing + RBAC + ORM together), not just the service layer. See TODO_SPEC.md stage 10
("בדיקות אינטגרציה ל-API — אירועים")."""
import pytest

from tests.conftest import auth_headers


def _incident_payload(property_id: int, **overrides) -> dict:
    payload = {
        "property_id": property_id,
        "incident_timestamp": "2024-06-01T10:00:00",
        "hazard_type": "FIRE",
        "severity_level": "MEDIUM",
        "operational_impact": "PARTIAL_SHUTDOWN",
        "initial_estimated_loss": 50000,
        "description": "שריפה קטנה במחסן",
    }
    payload.update(overrides)
    return payload


def test_create_and_get_incident(client, make_property, make_user, reader_headers):
    prop = make_property()
    reporter = make_user(role="FIELD_WORKER")  # incidents.create allows any authenticated role

    resp = client.post("/api/incidents", json=_incident_payload(prop.property_id), headers=auth_headers(reporter))
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "NEW"
    assert body["incident_code"].startswith("INC-")

    get_resp = client.get(f"/api/incidents/{body['incident_id']}", headers=reader_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["description"] == "שריפה קטנה במחסן"
    # TODO_SPEC.md §11 item 2: resolved_address is server-derived (reverse-geocoded
    # from reported_coordinates — see app/integrations/gis.reverse_geocode), not
    # part of the create payload, so a freshly-created incident has none yet.
    assert get_resp.json()["resolved_address"] is None


def test_create_incident_requires_auth(client, make_property):
    prop = make_property()
    resp = client.post("/api/incidents", json=_incident_payload(prop.property_id))
    assert resp.status_code == 401


def test_create_incident_for_missing_property_is_404(client, make_user):
    reporter = make_user(role="FIELD_WORKER")
    resp = client.post("/api/incidents", json=_incident_payload(999999), headers=auth_headers(reporter))
    assert resp.status_code == 404


def test_critical_incident_auto_creates_mitigation_task(client, make_property, make_user, reader_headers):
    """CRITICAL-severity incidents trigger an auto-generated follow-up mitigation
    task (see incidents.py _trigger_critical_incident_ticket)."""
    prop = make_property()
    reporter = make_user(role="FIELD_WORKER")

    resp = client.post(
        "/api/incidents",
        json=_incident_payload(
            prop.property_id,
            hazard_type="STRUCTURAL_FAILURE",
            severity_level="CRITICAL",
            operational_impact="FULL_SHUTDOWN",
            initial_estimated_loss=900000,
            description="קריסת תקרה חלקית",
        ),
        headers=auth_headers(reporter),
    )
    assert resp.status_code == 201

    tasks = client.get("/api/mitigation-tasks", headers=reader_headers).json()
    assert any(t["property_id"] == prop.property_id for t in tasks)


def test_critical_incident_dispatches_alert_to_recipients(client, make_property, make_user, db):
    """CRITICAL-severity incidents also fire a simulated Push/SMS/Email alert to the
    active Notification_Recipients (TODO_SPEC.md §2, "אוטומציית שטח (ERP & Alerts)"),
    logged as an audit row in Notification_Log — see
    incidents.py::_trigger_critical_incident_ticket ->
    services/notifications.dispatch_critical_incident_alert."""
    from app import models

    db.add(models.NotificationRecipient(
        role="risk_officer", display_name="קצין סיכונים", email="ro@example.com",
        phone="+972-50-111", channels="EMAIL,SMS", min_severity="warning", is_active=True,
    ))
    db.commit()

    prop = make_property()
    reporter = make_user(role="FIELD_WORKER")
    resp = client.post(
        "/api/incidents",
        json=_incident_payload(
            prop.property_id,
            hazard_type="FIRE",
            severity_level="CRITICAL",
            operational_impact="FULL_SHUTDOWN",
            initial_estimated_loss=900000,
            description="שריפה גדולה",
        ),
        headers=auth_headers(reporter),
    )
    assert resp.status_code == 201
    incident_code = resp.json()["incident_code"]

    admin = make_user(role="ADMIN")
    log_rows = client.get("/api/notifications/log", headers=auth_headers(admin)).json()
    critical_rows = [r for r in log_rows if r["alert_type"] == "critical_incident"]
    assert len(critical_rows) == 2  # one recipient x two channels (EMAIL, SMS)
    assert all(r["status"] == "simulated" for r in critical_rows)
    assert all(incident_code in r["title"] or incident_code in r["message"] for r in critical_rows)


def test_non_critical_incident_does_not_dispatch_alert(client, make_property, make_user, db):
    from app import models

    db.add(models.NotificationRecipient(
        role="risk_officer", display_name="קצין סיכונים", email="ro@example.com",
        phone="+972-50-111", channels="EMAIL", min_severity="warning", is_active=True,
    ))
    db.commit()

    prop = make_property()
    reporter = make_user(role="FIELD_WORKER")
    client.post(
        "/api/incidents",
        json=_incident_payload(prop.property_id, severity_level="MEDIUM"),
        headers=auth_headers(reporter),
    )

    admin = make_user(role="ADMIN")
    log_rows = client.get("/api/notifications/log", headers=auth_headers(admin)).json()
    assert [r for r in log_rows if r["alert_type"] == "critical_incident"] == []


def test_draft_incident_can_be_edited_then_submitted(client, make_property, make_user):
    prop = make_property()
    reporter = make_user(role="FIELD_WORKER")
    headers = auth_headers(reporter)

    draft = client.post(
        "/api/incidents",
        json=_incident_payload(prop.property_id, description="טיוטה ראשונית", is_draft=True),
        headers=headers,
    ).json()
    assert draft["is_draft"] is True

    patched = client.patch(f"/api/incidents/{draft['incident_id']}", json={"description": "עודכן"}, headers=headers).json()
    assert patched["description"] == "עודכן"

    submitted = client.patch(f"/api/incidents/{draft['incident_id']}/submit", headers=headers).json()
    assert submitted["is_draft"] is False

    # A submitted incident's content is frozen — editing again is rejected.
    resp = client.patch(f"/api/incidents/{draft['incident_id']}", json={"description": "שוב"}, headers=headers)
    assert resp.status_code == 400


def test_incident_status_cannot_move_backwards(client, make_property, make_user):
    prop = make_property()
    manager = make_user(role="RISK_MANAGER")
    headers = auth_headers(manager)

    incident = client.post("/api/incidents", json=_incident_payload(prop.property_id), headers=headers).json()

    advance = client.patch(
        f"/api/incidents/{incident['incident_id']}/status", json={"status": "UNDER_INVESTIGATION"}, headers=headers
    )
    assert advance.status_code == 200

    regress = client.patch(f"/api/incidents/{incident['incident_id']}/status", json={"status": "NEW"}, headers=headers)
    assert regress.status_code == 400


def test_incident_status_update_requires_permitted_role(client, make_property, make_user):
    prop = make_property()
    reporter = make_user(role="FIELD_WORKER")
    incident = client.post("/api/incidents", json=_incident_payload(prop.property_id), headers=auth_headers(reporter)).json()

    # FIELD_WORKER can create incidents but isn't in _STATUS_WRITE_ROLES.
    resp = client.patch(
        f"/api/incidents/{incident['incident_id']}/status",
        json={"status": "UNDER_INVESTIGATION"},
        headers=auth_headers(reporter),
    )
    assert resp.status_code == 403


def test_incident_status_update_requires_auth(client, make_property, make_user):
    prop = make_property()
    reporter = make_user(role="FIELD_WORKER")
    incident = client.post("/api/incidents", json=_incident_payload(prop.property_id), headers=auth_headers(reporter)).json()

    resp = client.patch(f"/api/incidents/{incident['incident_id']}/status", json={"status": "UNDER_INVESTIGATION"})
    assert resp.status_code == 401


def test_incident_timestamp_with_offset_is_stored_as_naive_utc(client, make_property, make_user, reader_headers):
    """The frontend sends `toISOString()` ("...Z"/offset). It must be stored — and read
    back — as naive UTC (models.py convention), not by its wall-clock digits alone."""
    prop = make_property()
    reporter = make_user(role="FIELD_WORKER")

    resp = client.post(
        "/api/incidents",
        json=_incident_payload(prop.property_id, incident_timestamp="2024-06-01T10:00:00+03:00"),
        headers=auth_headers(reporter),
    )
    assert resp.status_code == 201

    stored = client.get(f"/api/incidents/{resp.json()['incident_id']}", headers=reader_headers).json()["incident_timestamp"]
    assert stored == "2024-06-01T07:00:00"

def test_create_incident_records_the_authenticated_reporter(client, db, make_property, make_user):
    """The report form never sends reported_by_user_id — the server records the caller."""
    from app import models

    prop = make_property()
    reporter = make_user(role="FIELD_WORKER")
    resp = client.post("/api/incidents", json=_incident_payload(prop.property_id), headers=auth_headers(reporter))
    assert resp.status_code == 201

    incident = db.get(models.Incident, resp.json()["incident_id"])
    db.refresh(incident)
    assert incident.reported_by_user_id == reporter.user_id


@pytest.mark.parametrize("claimed_reporter", ["other_user", 999_999])
def test_a_client_supplied_reporter_is_ignored(client, db, make_property, make_user, claimed_reporter):
    """A caller can't file a report in someone else's name, and an unknown id is not
    an FK error (500)."""
    from app import models

    prop = make_property()
    reporter = make_user(role="FIELD_WORKER")
    if claimed_reporter == "other_user":
        claimed_reporter = make_user(role="RISK_MANAGER").user_id
    resp = client.post(
        "/api/incidents",
        json=_incident_payload(prop.property_id, reported_by_user_id=claimed_reporter),
        headers=auth_headers(reporter),
    )
    assert resp.status_code == 201, resp.text

    incident = db.get(models.Incident, resp.json()["incident_id"])
    db.refresh(incident)
    assert incident.reported_by_user_id == reporter.user_id


def test_property_filter_zero_matches_no_property(client, make_property, make_incident, reader_headers):
    """property_id=0 is a filter like any other (no property has id 0), not "no filter"."""
    make_incident(make_property().property_id)
    resp = client.get("/api/incidents", params={"property_id": 0}, headers=reader_headers)
    assert resp.status_code == 200
    assert resp.json() == []


def test_same_hazard_reported_by_two_users_is_not_treated_as_a_duplicate(client, make_property, make_user):
    """Duplicate suppression (double-click / retry) is per reporter: a second field
    worker reporting the same hazard at the same property seconds later is a separate
    report, not a duplicate of the first one."""
    prop = make_property()
    first = make_user(role="FIELD_WORKER")
    second = make_user(role="FIELD_WORKER")

    a = client.post("/api/incidents", json=_incident_payload(prop.property_id), headers=auth_headers(first))
    b = client.post("/api/incidents", json=_incident_payload(prop.property_id), headers=auth_headers(second))
    again = client.post("/api/incidents", json=_incident_payload(prop.property_id), headers=auth_headers(second))

    assert a.json()["incident_id"] != b.json()["incident_id"]
    assert again.json()["incident_id"] == b.json()["incident_id"]  # same user's double-submit still deduped