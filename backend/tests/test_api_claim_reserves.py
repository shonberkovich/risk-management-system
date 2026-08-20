"""Integration tests: /api/claims/{claim_id}/reserves (Claim_Reserves create/update)
— TODO_SPEC.md §2, "API לעדכון רזרבות (Claim_Reserves)"."""
from tests.conftest import auth_headers


def _open_incident(client, make_property, make_user):
    prop = make_property()
    reporter = make_user(role="FIELD_WORKER")
    incident = client.post(
        "/api/incidents",
        json={
            "property_id": prop.property_id,
            "incident_timestamp": "2024-06-01T10:00:00",
            "hazard_type": "FIRE",
            "severity_level": "MEDIUM",
            "operational_impact": "PARTIAL_SHUTDOWN",
            "initial_estimated_loss": 200000,
            "description": "x",
        },
        headers=auth_headers(reporter),
    ).json()
    return incident


def _open_claim(client, make_property, make_user, make_policy, headers):
    incident = _open_incident(client, make_property, make_user)
    policy = make_policy()
    claim = client.post(
        "/api/claims",
        json={"incident_id": incident["incident_id"], "policy_id": policy.policy_id, "claimed_amount": 150000},
        headers=headers,
    ).json()
    return claim


def test_create_reserve_requires_write_role(client, make_property, make_user, make_policy):
    manager = make_user(role="RISK_MANAGER")
    claim = _open_claim(client, make_property, make_user, make_policy, auth_headers(manager))
    field_worker = make_user(role="FIELD_WORKER")

    resp = client.post(
        f"/api/claims/{claim['claim_id']}/reserves",
        json={"reserve_amount": 100000},
        headers=auth_headers(field_worker),
    )
    assert resp.status_code == 403


def test_create_reserve_for_missing_claim_is_404(client, make_user):
    manager = make_user(role="RISK_MANAGER")
    resp = client.post(
        "/api/claims/999999/reserves", json={"reserve_amount": 100000}, headers=auth_headers(manager)
    )
    assert resp.status_code == 404


def test_create_and_list_reserves(client, make_property, make_user, make_policy):
    manager = make_user(role="RISK_MANAGER")
    headers = auth_headers(manager)
    claim = _open_claim(client, make_property, make_user, make_policy, headers)

    resp = client.post(
        f"/api/claims/{claim['claim_id']}/reserves",
        json={"reserve_amount": 100000, "expected_payment_date": "2024-09-01"},
        headers=headers,
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["reserve_amount"] == 100000
    assert body["claim_id"] == claim["claim_id"]

    listed = client.get(f"/api/claims/{claim['claim_id']}/reserves")
    assert listed.status_code == 200
    assert len(listed.json()) == 1


def test_create_reserve_on_closed_claim_is_rejected(client, make_property, make_user, make_policy):
    admin = make_user(role="ADMIN")
    headers = auth_headers(admin)
    claim = _open_claim(client, make_property, make_user, make_policy, headers)

    client.patch(f"/api/claims/{claim['claim_id']}", json={"claim_status": "APPROVED", "approved_amount": 150000}, headers=headers)
    client.patch(f"/api/claims/{claim['claim_id']}", json={"claim_status": "SETTLED"}, headers=headers)

    resp = client.post(
        f"/api/claims/{claim['claim_id']}/reserves", json={"reserve_amount": 100000}, headers=headers
    )
    assert resp.status_code == 400


def test_update_reserve(client, make_property, make_user, make_policy):
    manager = make_user(role="RISK_MANAGER")
    headers = auth_headers(manager)
    claim = _open_claim(client, make_property, make_user, make_policy, headers)
    created = client.post(
        f"/api/claims/{claim['claim_id']}/reserves", json={"reserve_amount": 100000}, headers=headers
    ).json()

    resp = client.patch(
        f"/api/claims/{claim['claim_id']}/reserves/{created['reserve_id']}",
        json={"reserve_amount": 80000},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["reserve_amount"] == 80000


def test_update_missing_reserve_is_404(client, make_property, make_user, make_policy):
    manager = make_user(role="RISK_MANAGER")
    headers = auth_headers(manager)
    claim = _open_claim(client, make_property, make_user, make_policy, headers)

    resp = client.patch(
        f"/api/claims/{claim['claim_id']}/reserves/999999", json={"reserve_amount": 1}, headers=headers
    )
    assert resp.status_code == 404
