"""Partial updates (schemas.PartialUpdate): leaving a field out keeps it, an explicit
null on a NOT NULL column is a 422 (it used to reach the column and fail as a 500),
and null still clears the columns that are nullable."""
import pytest

from tests.conftest import auth_headers


@pytest.mark.parametrize(
    "field",
    ["hazard_type", "description", "incident_timestamp", "initial_estimated_loss", "property_id",
     "business_interruption_requested"],
)
def test_null_on_a_required_incident_draft_field_is_422(client, make_user, make_property, make_incident, field):
    incident = make_incident(make_property().property_id, is_draft=True)
    resp = client.patch(
        f"/api/incidents/{incident.incident_id}", json={field: None}, headers=auth_headers(make_user(role="FIELD_WORKER"))
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"][0]["loc"] == ["body", field]


def test_null_clears_an_incident_drafts_area(client, make_user, make_property, make_incident):
    incident = make_incident(make_property().property_id, is_draft=True, area_or_building="מחסן 2")
    resp = client.patch(
        f"/api/incidents/{incident.incident_id}",
        json={"area_or_building": None},
        headers=auth_headers(make_user(role="FIELD_WORKER")),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["area_or_building"] is None


@pytest.mark.parametrize("field", ["title", "cost_estimate", "expected_annual_savings", "due_date", "status"])
def test_null_on_a_required_mitigation_field_is_422(client, make_user, make_property, make_mitigation_task, field):
    task = make_mitigation_task(make_property().property_id)
    resp = client.patch(
        f"/api/mitigation-tasks/{task.task_id}", json={field: None}, headers=auth_headers(make_user(role="RISK_MANAGER"))
    )
    assert resp.status_code == 422, resp.text


def test_null_unassigns_a_mitigation_task(client, make_user, make_property, make_mitigation_task):
    assignee = make_user(role="PROPERTY_MANAGER")
    task = make_mitigation_task(make_property().property_id, assigned_to_user_id=assignee.user_id)
    resp = client.patch(
        f"/api/mitigation-tasks/{task.task_id}",
        json={"assigned_to_user_id": None},
        headers=auth_headers(make_user(role="RISK_MANAGER")),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["assigned_to_user_id"] is None


@pytest.mark.parametrize("field", ["role", "display_name", "email", "phone", "channels", "min_severity", "is_active"])
def test_null_on_a_notification_recipient_field_is_422(client, make_user, field):
    headers = auth_headers(make_user(role="ADMIN"))
    created = client.post(
        "/api/notifications/recipients",
        json={"role": "RISK_MANAGER", "display_name": "נמען", "email": "r@example.com", "phone": "050-0000000",
              "channels": ["EMAIL"]},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    resp = client.patch(
        f"/api/notifications/recipients/{created.json()['recipient_id']}", json={field: None}, headers=headers
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.parametrize("field", ["full_name", "email", "role", "is_active"])
def test_null_on_a_user_field_is_422_not_email_already_exists(client, make_user, field):
    target = make_user(role="FIELD_WORKER")
    resp = client.patch(
        f"/api/users/{target.user_id}", json={field: None}, headers=auth_headers(make_user(role="ADMIN"))
    )
    assert resp.status_code == 422, resp.text


def test_null_password_keeps_the_current_one(client, make_user):
    target = make_user(role="FIELD_WORKER")
    resp = client.patch(
        f"/api/users/{target.user_id}",
        json={"full_name": "שם חדש", "password": None},
        headers=auth_headers(make_user(role="ADMIN")),
    )
    assert resp.status_code == 200, resp.text
    assert auth_headers(target)  # still logs in with the old password


def test_null_on_policy_and_claim_required_fields_is_422(
    client, make_user, make_property, make_incident, make_policy, make_claim
):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    policy = make_policy()
    claim = make_claim(make_incident(make_property().property_id).incident_id, policy.policy_id)

    assert client.put(f"/api/policies/{policy.policy_id}", json={"status": None}, headers=headers).status_code == 422
    assert client.put(f"/api/policies/{policy.policy_id}", json={"total_limit": None}, headers=headers).status_code == 422
    cleared = client.put(
        f"/api/policies/{policy.policy_id}", json={"exclusions": None, "per_event_limit": None}, headers=headers
    )
    assert cleared.status_code == 200, cleared.text

    assert client.patch(f"/api/claims/{claim.claim_id}", json={"approved_amount": None}, headers=headers).status_code == 422
    assert client.patch(f"/api/claims/{claim.claim_id}", json={"claim_status": None}, headers=headers).status_code == 422
    cleared = client.patch(f"/api/claims/{claim.claim_id}", json={"expected_payment_date": None}, headers=headers)
    assert cleared.status_code == 200, cleared.text


def test_null_on_property_required_field_is_422_but_clears_its_manager(client, make_user, make_property):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    prop = make_property()
    assert client.put(f"/api/properties/{prop.property_id}", json={"name": None}, headers=headers).status_code == 422
    resp = client.put(f"/api/properties/{prop.property_id}", json={"primary_manager_id": None}, headers=headers)
    assert resp.status_code == 200, resp.text
