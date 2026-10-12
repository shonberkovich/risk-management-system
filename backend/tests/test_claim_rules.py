"""Claim rules in routers/claims.py (and the matching eligible-policies filter in
routers/incidents.py): a claim is opened only on an active policy that insures the
incident's property for the incident date; amounts are consistent (claimed > 0,
deductible <= claimed, approved <= claimed and the policy limit, approved >= paid);
status only moves forward along the documented lifecycle; payments are whole agorot,
never above the approved amount, and dated between the incident and today; and a
closed claim's reserve leaves "open reserves"."""
from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest

from app import models
from app.services import cashflow
from tests.conftest import auth_headers


@pytest.fixture()
def manager_headers(make_user):
    return auth_headers(make_user(role="RISK_MANAGER"))


@pytest.fixture()
def incident_and_policy(make_property, make_incident, make_policy):
    prop = make_property()
    incident = make_incident(prop.property_id)  # 2024-06-01
    policy = make_policy(covers=prop.property_id, total_limit=500_000)  # 2024-01-01..2025-01-01
    return incident, policy


def _file(client, headers, incident, policy, **body):
    return client.post(
        "/api/claims",
        json={"incident_id": incident.incident_id, "policy_id": policy.policy_id, "claimed_amount": 100_000, **body},
        headers=headers,
    )


# --- which policy a claim can be filed on ---------------------------------------


def test_a_covering_active_policy_for_the_incident_date_is_accepted(client, manager_headers, incident_and_policy):
    incident, policy = incident_and_policy
    assert _file(client, manager_headers, incident, policy).status_code == 201


def test_a_policy_that_does_not_cover_the_property_is_rejected(client, manager_headers, make_property, make_incident, make_policy):
    incident = make_incident(make_property().property_id)
    other = make_policy(covers=make_property().property_id)
    resp = _file(client, manager_headers, incident, other)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "הפוליסה שנבחרה אינה מכסה את הנכס של האירוע"


def test_an_inactive_policy_is_rejected(client, manager_headers, make_property, make_incident, make_policy):
    prop = make_property()
    incident = make_incident(prop.property_id)
    expired = make_policy(covers=prop.property_id, status="EXPIRED")
    resp = _file(client, manager_headers, incident, expired)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "ניתן לפתוח תביעה רק על פוליסה פעילה"


def test_a_policy_whose_period_excludes_the_incident_is_rejected(client, manager_headers, make_property, make_incident, make_policy):
    prop = make_property()
    incident = make_incident(prop.property_id)  # 2024-06-01
    old = make_policy(covers=prop.property_id, start_date=date(2018, 1, 1), end_date=date(2018, 12, 31))
    resp = _file(client, manager_headers, incident, old)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "מועד האירוע אינו בתקופת הכיסוי של הפוליסה"


def test_eligible_policies_apply_the_same_period_rule(client, manager_headers, make_property, make_incident, make_policy):
    prop = make_property()
    incident = make_incident(prop.property_id)
    current = make_policy(covers=prop.property_id)
    make_policy(covers=prop.property_id, start_date=date(2018, 1, 1), end_date=date(2018, 12, 31))
    make_policy(covers=prop.property_id, status="EXPIRED")

    resp = client.get(f"/api/incidents/{incident.incident_id}/eligible-policies", headers=manager_headers)
    assert resp.status_code == 200
    assert [p["policy_id"] for p in resp.json()] == [current.policy_id]


# --- claim amounts -----------------------------------------------------------------


@pytest.mark.parametrize("claimed", [0, -1])
def test_a_zero_or_negative_claim_is_422(client, manager_headers, incident_and_policy, claimed):
    incident, policy = incident_and_policy
    assert _file(client, manager_headers, incident, policy, claimed_amount=claimed).status_code == 422


def test_a_deductible_above_the_claim_is_422(client, manager_headers, incident_and_policy):
    incident, policy = incident_and_policy
    resp = _file(client, manager_headers, incident, policy, claimed_amount=100, deductible_applied=9000)
    assert resp.status_code == 422
    assert "ההשתתפות העצמית לא יכולה לעלות על הסכום הנתבע" in resp.text
    assert _file(client, manager_headers, incident, policy, claimed_amount=9000, deductible_applied=9000).status_code == 201


# --- updates: amounts and status ------------------------------------------------------


@pytest.fixture()
def claim(make_claim, incident_and_policy):
    incident, policy = incident_and_policy
    return make_claim(incident.incident_id, policy.policy_id, claimed_amount=100_000, claim_status="DRAFT")


def _patch(client, headers, claim, **body):
    return client.patch(f"/api/claims/{claim.claim_id}", json=body, headers=headers)


def test_approved_above_the_claim_is_rejected(client, manager_headers, claim):
    resp = _patch(client, manager_headers, claim, claim_status="APPROVED", approved_amount=100_001)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "הסכום המאושר לא יכול לעלות על הסכום הנתבע"


def test_approved_above_the_policy_limit_is_rejected(client, manager_headers, make_claim, incident_and_policy):
    incident, policy = incident_and_policy  # total_limit 500,000
    big = make_claim(incident.incident_id, policy.policy_id, claimed_amount=900_000, claim_status="DRAFT")
    resp = _patch(client, manager_headers, big, claim_status="APPROVED", approved_amount=600_000)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "הסכום המאושר חורג מגבול האחריות של הפוליסה"
    assert _patch(client, manager_headers, big, claim_status="APPROVED", approved_amount=500_000).status_code == 200


def test_approving_needs_an_approved_amount(client, manager_headers, claim):
    resp = _patch(client, manager_headers, claim, claim_status="APPROVED")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "יש להזין סכום מאושר לפני אישור או סגירה של התביעה"


def test_the_forward_lifecycle_is_allowed_including_skipping_review(client, manager_headers, claim):
    assert _patch(client, manager_headers, claim, claim_status="SUBMITTED").status_code == 200
    assert _patch(client, manager_headers, claim, claim_status="APPROVED", approved_amount=50_000).status_code == 200
    assert _patch(client, manager_headers, claim, claim_status="SETTLED").status_code == 200


@pytest.mark.parametrize(
    "start,target",
    [("DRAFT", "SETTLED"), ("SUBMITTED", "SETTLED"), ("APPROVED", "DRAFT"), ("IN_ADJUSTMENT", "SUBMITTED")],
)
def test_backward_moves_and_settling_unapproved_claims_are_rejected(
    client, manager_headers, make_claim, incident_and_policy, start, target
):
    incident, policy = incident_and_policy
    c = make_claim(
        incident.incident_id, policy.policy_id, claim_status=start, approved_amount=50_000 if start == "APPROVED" else 0
    )
    resp = _patch(client, manager_headers, c, claim_status=target)
    assert resp.status_code == 400
    assert "תביעה מתקדמת רק קדימה" in resp.json()["detail"]


def test_settling_a_never_approved_claim_no_longer_closes_its_incident(client, db, manager_headers, claim):
    _patch(client, manager_headers, claim, claim_status="SETTLED")
    db.expire_all()
    assert db.get(models.Incident, claim.incident_id).status != "CLOSED"


def _pay(client, headers, claim, amount, day="2024-06-10"):
    return client.post(
        f"/api/claims/{claim.claim_id}/payments",
        json={"payment_date": day, "amount": amount, "payment_type": "ADVANCE"},
        headers=headers,
    )


@pytest.fixture()
def approved(make_claim, incident_and_policy):
    incident, policy = incident_and_policy
    return make_claim(incident.incident_id, policy.policy_id, claim_status="APPROVED", approved_amount=500)


def test_approved_cannot_drop_below_what_was_paid(client, manager_headers, approved):
    assert _pay(client, manager_headers, approved, 300).status_code == 201
    resp = _patch(client, manager_headers, approved, approved_amount=200)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "הסכום המאושר לא יכול להיות נמוך מהסכום ששולם עד כה"
    assert _patch(client, manager_headers, approved, approved_amount=300).status_code == 200


def test_a_claim_with_payments_cannot_be_rejected(client, manager_headers, approved):
    assert _pay(client, manager_headers, approved, 100).status_code == 201
    resp = _patch(client, manager_headers, approved, claim_status="REJECTED")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "לא ניתן לדחות תביעה שכבר שולמו עליה תשלומים"


def test_an_unpaid_claim_can_still_be_rejected(client, manager_headers, claim):
    assert _patch(client, manager_headers, claim, claim_status="REJECTED").status_code == 200


# --- payments ---------------------------------------------------------------------


@pytest.mark.parametrize("amount", [0.004, 0.001])
def test_a_sub_agora_payment_is_rejected_not_stored_as_zero(client, manager_headers, approved, amount):
    resp = _pay(client, manager_headers, approved, amount)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "סכום התשלום חייב להיות חיובי"


def test_payments_cannot_exceed_the_approved_amount_by_even_one_agora(client, manager_headers, approved):
    assert _pay(client, manager_headers, approved, 499.99).status_code == 201
    assert _pay(client, manager_headers, approved, 0.02).status_code == 400
    assert _pay(client, manager_headers, approved, 0.01).status_code == 201


def test_payment_dates_are_between_the_incident_and_today(client, manager_headers, approved):
    before = _pay(client, manager_headers, approved, 1, day="2024-05-31")  # incident is 2024-06-01
    assert before.status_code == 400
    assert before.json()["detail"] == "מועד התשלום לא יכול להיות לפני מועד האירוע"
    future = _pay(client, manager_headers, approved, 1, day=(date.today() + timedelta(days=1)).isoformat())
    assert future.status_code == 400
    assert future.json()["detail"] == "מועד התשלום לא יכול להיות בעתיד"
    assert _pay(client, manager_headers, approved, 1, day=date.today().isoformat()).status_code == 201


# --- reserves ---------------------------------------------------------------------


def test_a_closed_claims_reserve_leaves_open_reserves(db, make_claim, incident_and_policy):
    incident, policy = incident_and_policy
    open_claim = make_claim(incident.incident_id, policy.policy_id, claim_status="SUBMITTED")
    rejected = make_claim(incident.incident_id, policy.policy_id, claim_status="REJECTED")
    settled = make_claim(incident.incident_id, policy.policy_id, claim_status="SETTLED")
    for i, c in enumerate((open_claim, rejected, settled), start=1):
        db.add(models.ClaimReserve(reserve_id=i, claim_id=c.claim_id, reserve_amount=1_000 * i, updated_at=datetime(2024, 7, 1)))
    db.commit()

    assert cashflow.calculate_total_open_reserves(db) == 1_000
