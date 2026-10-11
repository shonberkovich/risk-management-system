"""Required text that names or describes a record (schemas.NonBlankStr) is a 422 when
empty or whitespace-only, on create and on update — the forms already require
.trim(), this is the same rule for direct API calls."""
import pytest

from tests.conftest import auth_headers

BLANKS = ["", "   ", "\n\t "]

PROPERTY = {
    "property_code": "PRP-BLANK-1", "name": "נכס", "address": "רחוב 1", "region": "מרכז",
    "latitude": 32.0, "longitude": 34.8, "asset_type": "RETAIL", "replacement_value": 1_000_000, "book_value": 900_000,
}
POLICY = {
    "policy_number": "POL-BLANK-1", "insurer_name": "מבטח", "start_date": "2024-01-01", "end_date": "2025-01-01",
    "total_limit": 1000, "deductible_default": 0, "annual_premium": 0,
}
RECIPIENT = {"role": "RISK_MANAGER", "display_name": "נמען", "email": "r@example.com", "phone": "", "channels": ["EMAIL"]}
RULE = {
    "name": "כלל",
    "conditions": [{"field": "subject", "operator": "contains", "value": "דחוף"}],
    "actions": [{"type": "mark_as_read"}],
}
TEMPLATE = {"name": "תבנית", "subject_template": "נושא", "body_template": "גוף"}

CREATE_CASES = [
    ("ADMIN", "/api/properties", PROPERTY, "property_code"),
    ("ADMIN", "/api/properties", PROPERTY, "name"),
    ("ADMIN", "/api/properties", PROPERTY, "address"),
    ("ADMIN", "/api/properties", PROPERTY, "region"),
    ("ADMIN", "/api/policies", POLICY, "policy_number"),
    ("ADMIN", "/api/policies", POLICY, "insurer_name"),
    ("ADMIN", "/api/users", {"full_name": "משתמש", "email": "u@example.com", "role": "FIELD_WORKER"}, "full_name"),
    ("ADMIN", "/api/notifications/recipients", RECIPIENT, "display_name"),
    ("ADMIN", "/api/notifications/recipients", RECIPIENT, "role"),
    ("ADMIN", "/api/role-permissions", {"role": "RISK_MANAGER", "permission_key": "x:view"}, "permission_key"),
    ("ADMIN", "/api/folders", {"name": "תגית", "color": "#000"}, "name"),
    ("ADMIN", "/api/rules", RULE, "name"),
    ("ADMIN", "/api/email-templates", TEMPLATE, "name"),
]


@pytest.mark.parametrize("blank", BLANKS)
@pytest.mark.parametrize("role,path,payload,field", CREATE_CASES)
def test_blank_required_text_is_422_on_create(client, make_user, role, path, payload, field, blank):
    resp = client.post(path, json={**payload, field: blank}, headers=auth_headers(make_user(role=role)))
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"][0]["loc"][-1] == field


@pytest.mark.parametrize("blank", BLANKS)
def test_blank_incident_description_and_task_title_are_422(client, make_user, make_property, blank):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    prop = make_property()
    incident = {
        "property_id": prop.property_id, "incident_timestamp": "2024-06-01T10:00:00", "hazard_type": "FIRE",
        "severity_level": "MEDIUM", "operational_impact": "PARTIAL_SHUTDOWN", "initial_estimated_loss": 0,
        "description": blank,
    }
    assert client.post("/api/incidents", json=incident, headers=headers).status_code == 422
    task = {"property_id": prop.property_id, "title": blank, "cost_estimate": 0, "due_date": "2030-01-01"}
    assert client.post("/api/mitigation-tasks", json=task, headers=headers).status_code == 422


def test_blank_email_rule_condition_value_is_422(client, make_user):
    """"" would match every incoming message ("" is in any text)."""
    rule = {**RULE, "conditions": [{"field": "subject", "operator": "contains", "value": " "}]}
    resp = client.post("/api/rules", json=rule, headers=auth_headers(make_user(role="FIELD_WORKER")))
    assert resp.status_code == 422, resp.text


def test_blank_text_is_422_on_update(client, make_user, make_property, make_incident, make_mitigation_task, make_policy):
    headers = auth_headers(make_user(role="ADMIN"))
    prop = make_property()
    draft = make_incident(prop.property_id, is_draft=True)
    task = make_mitigation_task(prop.property_id)
    policy = make_policy()
    target = make_user(role="FIELD_WORKER")

    for method, path, body in [
        ("patch", f"/api/incidents/{draft.incident_id}", {"description": "  "}),
        ("patch", f"/api/mitigation-tasks/{task.task_id}", {"title": ""}),
        ("put", f"/api/properties/{prop.property_id}", {"name": " "}),
        ("put", f"/api/policies/{policy.policy_id}", {"insurer_name": ""}),
        ("patch", f"/api/users/{target.user_id}", {"full_name": "\t"}),
    ]:
        resp = getattr(client, method)(path, json=body, headers=headers)
        assert resp.status_code == 422, (path, resp.text)


def test_text_around_a_value_is_kept_as_sent(client, make_user, make_property):
    """Only blank values are rejected; the stored text isn't stripped."""
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    task = {"property_id": make_property().property_id, "title": " התקנת מתזים ", "cost_estimate": 0, "due_date": "2030-01-01"}
    resp = client.post("/api/mitigation-tasks", json=task, headers=headers)
    assert resp.status_code == 201, resp.text
    assert resp.json()["title"] == " התקנת מתזים "
