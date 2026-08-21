"""Unit tests for app/services/cashflow.py — reserve/receipt forecasting. Previously
uncovered (TODO_SPEC.md §9, "בדיקות Backend"): get_current_reserves, calculate_total_
open_reserves, calculate_claim_outstanding_balance, calculate_expected_receipts_by_month,
calculate_reserves_by_month, get_cashflow_summary."""
from datetime import date, datetime

from app import models
from app.services import cashflow


def _reserve(claim_id: int, reserve_id: int, amount: float, updated_at: datetime, **overrides) -> models.ClaimReserve:
    defaults = dict(
        reserve_id=reserve_id, claim_id=claim_id, reserve_amount=amount,
        expected_payment_date=None, updated_at=updated_at,
    )
    defaults.update(overrides)
    return models.ClaimReserve(**defaults)


def test_get_current_reserves_picks_most_recently_updated_per_claim(db, make_property, make_user, make_policy, make_incident, make_claim):
    prop = make_property()
    make_user(role="ADMIN")
    policy = make_policy()
    incident = make_incident(prop.property_id)
    claim = make_claim(incident.incident_id, policy.policy_id)

    db.add(_reserve(claim.claim_id, 1, 100_000, datetime(2024, 1, 1)))
    db.add(_reserve(claim.claim_id, 2, 80_000, datetime(2024, 6, 1)))  # newer -> wins
    db.commit()

    current = cashflow.get_current_reserves(db)
    assert len(current) == 1
    assert current[0].reserve_amount == 80_000


def test_calculate_total_open_reserves_sums_latest_only(db, make_property, make_policy, make_incident, make_claim):
    prop = make_property()
    policy = make_policy()
    incident1 = make_incident(prop.property_id)
    incident2 = make_incident(prop.property_id)
    claim1 = make_claim(incident1.incident_id, policy.policy_id)
    claim2 = make_claim(incident2.incident_id, policy.policy_id)

    db.add(_reserve(claim1.claim_id, 1, 50_000, datetime(2024, 1, 1)))
    db.add(_reserve(claim1.claim_id, 2, 40_000, datetime(2024, 3, 1)))  # supersedes reserve 1
    db.add(_reserve(claim2.claim_id, 3, 20_000, datetime(2024, 2, 1)))
    db.commit()

    assert cashflow.calculate_total_open_reserves(db) == 60_000


def test_calculate_total_open_reserves_empty_is_zero(db):
    assert cashflow.calculate_total_open_reserves(db) == 0.0


def test_calculate_claim_outstanding_balance_uses_approved_minus_paid(db, make_property, make_policy, make_incident, make_claim):
    prop = make_property()
    policy = make_policy()
    incident = make_incident(prop.property_id)
    claim = make_claim(incident.incident_id, policy.policy_id, claimed_amount=200_000, approved_amount=150_000)
    db.add(models.ClaimPayment(payment_id=1, claim_id=claim.claim_id, payment_date=date(2024, 6, 1), amount=50_000, payment_type="PARTIAL"))
    db.commit()
    db.refresh(claim)

    assert cashflow.calculate_claim_outstanding_balance(claim) == 100_000


def test_calculate_claim_outstanding_balance_falls_back_to_claimed_amount_when_not_approved(db, make_property, make_policy, make_incident, make_claim):
    prop = make_property()
    policy = make_policy()
    incident = make_incident(prop.property_id)
    claim = make_claim(incident.incident_id, policy.policy_id, claimed_amount=90_000, approved_amount=0)

    assert cashflow.calculate_claim_outstanding_balance(claim) == 90_000


def test_calculate_claim_outstanding_balance_never_negative(db, make_property, make_policy, make_incident, make_claim):
    prop = make_property()
    policy = make_policy()
    incident = make_incident(prop.property_id)
    claim = make_claim(incident.incident_id, policy.policy_id, claimed_amount=50_000, approved_amount=50_000)
    db.add(models.ClaimPayment(payment_id=1, claim_id=claim.claim_id, payment_date=date(2024, 6, 1), amount=70_000, payment_type="FULL"))
    db.commit()
    db.refresh(claim)

    assert cashflow.calculate_claim_outstanding_balance(claim) == 0.0


def test_calculate_expected_receipts_by_month_buckets_open_claims(db, make_property, make_policy, make_incident, make_claim):
    prop = make_property()
    policy = make_policy()

    incident_a = make_incident(prop.property_id)
    claim_a = make_claim(
        incident_a.incident_id, policy.policy_id, claimed_amount=100_000, approved_amount=100_000,
        claim_status="APPROVED", expected_payment_date=date(2024, 7, 15),
    )
    incident_b = make_incident(prop.property_id)
    claim_b = make_claim(
        incident_b.incident_id, policy.policy_id, claimed_amount=40_000, approved_amount=40_000,
        claim_status="IN_ADJUSTMENT", expected_payment_date=date(2024, 7, 20),
    )
    # No expected_payment_date -> excluded.
    incident_c = make_incident(prop.property_id)
    make_claim(incident_c.incident_id, policy.policy_id, claimed_amount=10_000, claim_status="SUBMITTED")
    # Fully paid (zero balance) -> excluded even though status is open.
    incident_d = make_incident(prop.property_id)
    claim_d = make_claim(
        incident_d.incident_id, policy.policy_id, claimed_amount=30_000, approved_amount=30_000,
        claim_status="APPROVED", expected_payment_date=date(2024, 8, 1),
    )
    db.add(models.ClaimPayment(payment_id=1, claim_id=claim_d.claim_id, payment_date=date(2024, 6, 1), amount=30_000, payment_type="FULL"))
    # Not an open status (SETTLED) -> excluded entirely.
    incident_e = make_incident(prop.property_id)
    make_claim(
        incident_e.incident_id, policy.policy_id, claimed_amount=5_000, approved_amount=5_000,
        claim_status="SETTLED", expected_payment_date=date(2024, 7, 1),
    )
    db.commit()

    receipts = cashflow.calculate_expected_receipts_by_month(db)
    assert receipts == [("2024-07", 140_000.0)]


def test_calculate_reserves_by_month_groups_unscheduled_last(db, make_property, make_policy, make_incident, make_claim):
    prop = make_property()
    policy = make_policy()
    incident1 = make_incident(prop.property_id)
    incident2 = make_incident(prop.property_id)
    claim1 = make_claim(incident1.incident_id, policy.policy_id)
    claim2 = make_claim(incident2.incident_id, policy.policy_id)

    db.add(_reserve(claim1.claim_id, 1, 30_000, datetime(2024, 1, 1), expected_payment_date=date(2024, 9, 1)))
    db.add(_reserve(claim2.claim_id, 2, 15_000, datetime(2024, 1, 1), expected_payment_date=None))
    db.commit()

    result = cashflow.calculate_reserves_by_month(db)
    assert result == [("2024-09", 30_000.0), ("unscheduled", 15_000.0)]


def test_get_cashflow_summary_combines_reserves_and_receipts(db, make_property, make_policy, make_incident, make_claim, monkeypatch):
    prop = make_property()
    policy = make_policy()

    incident1 = make_incident(prop.property_id)
    claim1 = make_claim(
        incident1.incident_id, policy.policy_id, claimed_amount=60_000, approved_amount=60_000,
        claim_status="APPROVED", expected_payment_date=date(2024, 3, 1),
    )
    db.add(_reserve(claim1.claim_id, 1, 25_000, datetime(2024, 1, 1), expected_payment_date=date(2024, 3, 1)))
    db.add(_reserve(claim1.claim_id, 2, 10_000, datetime(2024, 2, 1), expected_payment_date=None))  # unscheduled, latest reserve for claim1
    db.commit()

    # Fix "today" so the merged monthly window is deterministic regardless of when
    # this test runs.
    class _FixedDate(date):
        @classmethod
        def today(cls):
            return date(2024, 3, 1)

    monkeypatch.setattr(cashflow, "date", _FixedDate)

    summary = cashflow.get_cashflow_summary(db, months_ahead=3)
    assert summary["total_open_reserves"] == 10_000.0  # only the latest reserve row for claim1
    assert summary["total_expected_receipts"] == 60_000.0
    assert summary["unscheduled_reserves"] == 10_000.0
    months = {m["month"]: m for m in summary["monthly"]}
    assert months["2024-03"]["expected_receipts"] == 60_000.0
    assert months["2024-03"]["open_reserves"] == 0.0  # the 10k reserve is "unscheduled", not in any month bucket


def test_get_cashflow_summary_empty_db(db):
    summary = cashflow.get_cashflow_summary(db)
    assert summary == {
        "total_open_reserves": 0.0,
        "total_expected_receipts": 0.0,
        "unscheduled_reserves": 0.0,
        "monthly": [],
    }
