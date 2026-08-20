"""Integration tests: POST/GET/PATCH /api/incidents against a real FastAPI TestClient
(routing + RBAC + ORM together), not just the service layer. See TODO_SPEC.md stage 10
("בדיקות אינטגרציה ל-API — אירועים")."""
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


def test_create_and_get_incident(client, make_property, make_user):
    prop = make_property()
    reporter = make_user(role="FIELD_WORKER")  # incidents.create allows any authenticated role

    resp = client.post("/api/incidents", json=_incident_payload(prop.property_id), headers=auth_headers(reporter))
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "NEW"
    assert body["incident_code"].startswith("INC-")

    get_resp = client.get(f"/api/incidents/{body['incident_id']}")
    assert get_resp.status_code == 200
    assert get_resp.json()["description"] == "שריפה קטנה במחסן"


def test_create_incident_requires_auth(client, make_property):
    prop = make_property()
    resp = client.post("/api/incidents", json=_incident_payload(prop.property_id))
    assert resp.status_code == 401


def test_create_incident_for_missing_property_is_404(client, make_user):
    reporter = make_user(role="FIELD_WORKER")
    resp = client.post("/api/incidents", json=_incident_payload(999999), headers=auth_headers(reporter))
    assert resp.status_code == 404


def test_critical_incident_auto_creates_mitigation_task(client, make_property, make_user):
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

    tasks = client.get("/api/mitigation-tasks").json()
    assert any(t["property_id"] == prop.property_id for t in tasks)


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
