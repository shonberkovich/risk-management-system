"""A draft incident (is_draft) has no workflow until it's submitted: no status change
and no claim — only edits (PATCH /incidents/{id}) and PATCH .../submit. After the
submit the usual workflow applies."""
import pytest

from tests.conftest import auth_headers


@pytest.mark.parametrize("status", ["UNDER_INVESTIGATION", "CLOSED"])
def test_a_drafts_status_cannot_change(client, make_user, make_property, make_incident, status):
    draft = make_incident(make_property().property_id, is_draft=True)
    resp = client.patch(
        f"/api/incidents/{draft.incident_id}/status",
        json={"status": status},
        headers=auth_headers(make_user(role="RISK_MANAGER")),
    )
    assert resp.status_code == 400
    assert "טיוטה" in resp.json()["detail"]


def test_a_claim_cannot_be_filed_on_a_draft(client, make_user, make_property, make_incident, make_policy):
    draft = make_incident(make_property().property_id, is_draft=True)
    resp = client.post(
        "/api/claims",
        json={"incident_id": draft.incident_id, "policy_id": make_policy().policy_id, "claimed_amount": 1000},
        headers=auth_headers(make_user(role="RISK_MANAGER")),
    )
    assert resp.status_code == 400
    assert "טיוטת" in resp.json()["detail"]


def test_after_submit_the_workflow_applies(client, make_user, make_property, make_incident, make_policy):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    draft = make_incident(make_property().property_id, is_draft=True)

    submitted = client.patch(f"/api/incidents/{draft.incident_id}/submit", headers=headers)
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["is_draft"] is False

    moved = client.patch(
        f"/api/incidents/{draft.incident_id}/status", json={"status": "UNDER_INVESTIGATION"}, headers=headers
    )
    assert moved.status_code == 200, moved.text
    policy = make_policy(covers=draft.property_id)
    claim = client.post(
        "/api/claims",
        json={"incident_id": draft.incident_id, "policy_id": policy.policy_id, "claimed_amount": 1000},
        headers=headers,
    )
    assert claim.status_code == 201, claim.text
