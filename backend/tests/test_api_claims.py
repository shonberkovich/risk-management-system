"""Integration tests: /api/claims (creation opens a claim off an incident, moves the
incident to CLAIM_FILED, and updates are RBAC-gated). See TODO_SPEC.md stage 10
("בדיקות אינטגרציה ל-API — תביעות")."""
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


def test_create_claim_moves_incident_to_claim_filed(client, make_property, make_user, make_policy):
    incident = _open_incident(client, make_property, make_user)
    policy = make_policy()
    adjuster = make_user(role="ADJUSTER")

    resp = client.post(
        "/api/claims",
        json={
            "incident_id": incident["incident_id"],
            "policy_id": policy.policy_id,
            "claimed_amount": 150000,
        },
        headers=auth_headers(adjuster),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["claim_status"] == "DRAFT"
    assert body["claim_number"].startswith("CLM-")

    updated_incident = client.get(f"/api/incidents/{incident['incident_id']}").json()
    assert updated_incident["status"] == "CLAIM_FILED"


def test_create_claim_requires_write_role(client, make_property, make_user, make_policy):
    incident = _open_incident(client, make_property, make_user)
    policy = make_policy()
    field_worker = make_user(role="FIELD_WORKER")  # not in _CLAIMS_WRITE_ROLES

    resp = client.post(
        "/api/claims",
        json={"incident_id": incident["incident_id"], "policy_id": policy.policy_id, "claimed_amount": 1000},
        headers=auth_headers(field_worker),
    )
    assert resp.status_code == 403


def test_create_claim_for_missing_policy_is_404(client, make_property, make_user):
    incident = _open_incident(client, make_property, make_user)
    manager = make_user(role="RISK_MANAGER")

    resp = client.post(
        "/api/claims",
        json={"incident_id": incident["incident_id"], "policy_id": 999999, "claimed_amount": 1000},
        headers=auth_headers(manager),
    )
    assert resp.status_code == 404


def test_create_claim_for_closed_incident_is_rejected(client, make_property, make_user, make_policy):
    incident = _open_incident(client, make_property, make_user)
    policy = make_policy()
    manager = make_user(role="RISK_MANAGER")
    headers = auth_headers(manager)

    # Walk the incident through its full status lifecycle to CLOSED.
    client.patch(f"/api/incidents/{incident['incident_id']}/status", json={"status": "UNDER_INVESTIGATION"}, headers=headers)
    client.patch(f"/api/incidents/{incident['incident_id']}/status", json={"status": "CLOSED"}, headers=headers)

    resp = client.post(
        "/api/claims",
        json={"incident_id": incident["incident_id"], "policy_id": policy.policy_id, "claimed_amount": 1000},
        headers=headers,
    )
    assert resp.status_code == 400


def test_create_claim_payment_rejects_non_positive_amount(client, make_property, make_user, make_policy, make_claim):
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
    policy = make_policy()
    claim = make_claim(incident["incident_id"], policy.policy_id, claim_status="APPROVED", approved_amount=100_000)
    manager = make_user(role="RISK_MANAGER")

    for bad_amount in (0, -500):
        resp = client.post(
            f"/api/claims/{claim.claim_id}/payments",
            json={"payment_date": "2024-06-05", "amount": bad_amount, "payment_type": "ADVANCE"},
            headers=auth_headers(manager),
        )
        assert resp.status_code == 400, bad_amount


def test_list_claims_is_readable_without_auth(client, make_property, make_user, make_policy):
    incident = _open_incident(client, make_property, make_user)
    policy = make_policy()
    manager = make_user(role="RISK_MANAGER")
    client.post(
        "/api/claims",
        json={"incident_id": incident["incident_id"], "policy_id": policy.policy_id, "claimed_amount": 1000},
        headers=auth_headers(manager),
    )

    resp = client.get("/api/claims")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
