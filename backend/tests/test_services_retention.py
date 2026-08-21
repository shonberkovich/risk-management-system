"""Unit tests for app/services/retention.py's ABSORB-vs-CLAIM cost model —
the pure calculation layer behind routers/retention.py. Covers the boundary
between "below deductible" and "above deductible", the per_event_limit cap,
the specific_deductible override, the ABSORB/CLAIM tie-break rule, and the
incident convenience wrapper's None-on-no-coverage behavior.
"""
from __future__ import annotations

import pytest

from app.services import retention


def test_loss_below_deductible_recommends_absorb_with_zero_recoverable(db, make_property, make_policy):
    prop = make_property()
    policy = make_policy(deductible_default=50_000)

    result = retention.calculate_retention_recommendation(db, policy.policy_id, prop.property_id, 10_000)

    assert result["recommendation"] == "ABSORB"
    assert result["claim_recoverable_amount"] == 0.0
    assert result["claim_out_of_pocket"] == 10_000.0
    assert result["expected_premium_surcharge"] == 0.0
    assert result["claim_total_cost"] == result["absorb_total_cost"] == 10_000.0


def test_loss_exactly_at_deductible_recommends_absorb(db, make_property, make_policy):
    """The boundary case (`estimated_loss <= deductible`) — insurance recovers
    nothing at exactly the deductible either, same as strictly below it."""
    prop = make_property()
    policy = make_policy(deductible_default=50_000)

    result = retention.calculate_retention_recommendation(db, policy.policy_id, prop.property_id, 50_000)

    assert result["recommendation"] == "ABSORB"
    assert result["claim_recoverable_amount"] == 0.0


def test_loss_far_above_deductible_recommends_claim(db, make_property, make_policy):
    """A small deductible relative to a large loss makes filing clearly
    cheaper than absorbing — the premium surcharge on the recovered amount
    still comes out well below the full self-absorb cost."""
    prop = make_property()
    policy = make_policy(deductible_default=1_000)

    result = retention.calculate_retention_recommendation(db, policy.policy_id, prop.property_id, 100_000)

    assert result["claim_recoverable_amount"] == 99_000.0
    assert result["claim_out_of_pocket"] == 1_000.0
    assert result["expected_premium_surcharge"] == pytest.approx(99_000 * 0.15, rel=1e-6)
    assert result["claim_total_cost"] < result["absorb_total_cost"]
    assert result["recommendation"] == "CLAIM"


def test_tie_breaks_toward_absorb(db, make_property, make_policy):
    """When claim_total_cost exactly equals absorb_total_cost, the tie-break
    (`absorb_total_cost <= claim_total_cost`) favors ABSORB — filing a claim
    for zero net benefit isn't worth the paperwork/experience-rating hit."""
    # deductible D, loss L: claim_total = D + (L - D) * 0.15. Setting this equal to L:
    # D + 0.15L - 0.15D = L  =>  0.85D = 0.85L  =>  D = L. That's the "at deductible"
    # case already covered above — so construct an exact tie via per_event_limit
    # capping recoverable to 0 instead, which reduces to the same "D == effective loss" shape.
    prop = make_property()
    policy = make_policy(deductible_default=10_000, per_event_limit=0)

    result = retention.calculate_retention_recommendation(db, policy.policy_id, prop.property_id, 50_000)

    # per_event_limit=0 caps recoverable at 0 regardless of the loss/deductible gap.
    assert result["claim_recoverable_amount"] == 0.0
    assert result["claim_total_cost"] == result["absorb_total_cost"] == 50_000.0
    assert result["recommendation"] == "ABSORB"


def test_per_event_limit_caps_recoverable_amount(db, make_property, make_policy):
    prop = make_property()
    policy = make_policy(deductible_default=5_000, per_event_limit=20_000)

    result = retention.calculate_retention_recommendation(db, policy.policy_id, prop.property_id, 100_000)

    # Uncapped recoverable would be 95,000 — the per_event_limit caps it at 20,000.
    assert result["claim_recoverable_amount"] == 20_000.0
    assert result["claim_out_of_pocket"] == 80_000.0  # loss minus the capped recovery


def test_specific_deductible_overrides_policy_default(db, make_property, make_policy):
    prop = make_property()
    policy = make_policy(deductible_default=50_000)
    from app import models
    db.add(models.PolicyAsset(policy_id=policy.policy_id, property_id=prop.property_id, specific_deductible=5_000))
    db.commit()

    result = retention.calculate_retention_recommendation(db, policy.policy_id, prop.property_id, 20_000)

    assert result["deductible"] == 5_000.0
    assert result["claim_recoverable_amount"] == 15_000.0


def test_calculate_recommendation_raises_for_unknown_policy(db, make_property):
    prop = make_property()
    with pytest.raises(ValueError):
        retention.calculate_retention_recommendation(db, 999_999, prop.property_id, 10_000)


def test_calculate_recommendation_handles_zero_deductible_policy(db, make_property, make_policy):
    """A policy with no deductible at all (deductible_default=0) — every ₪ of
    loss is recoverable up to any per_event_limit; must not divide by zero or
    otherwise blow up on the degenerate deductible=0 case."""
    prop = make_property()
    policy = make_policy(deductible_default=0)

    result = retention.calculate_retention_recommendation(db, policy.policy_id, prop.property_id, 1_000)

    assert result["deductible"] == 0.0
    assert result["claim_recoverable_amount"] == 1_000.0
    assert result["claim_out_of_pocket"] == 0.0


def test_calculate_recommendation_handles_very_large_loss(db, make_property, make_policy):
    prop = make_property()
    policy = make_policy(deductible_default=10_000, per_event_limit=None)

    result = retention.calculate_retention_recommendation(db, policy.policy_id, prop.property_id, 10_000_000_000)

    assert result["claim_recoverable_amount"] == pytest.approx(9_999_990_000)
    assert result["recommendation"] == "CLAIM"


def test_effective_deductible_without_policy_asset_uses_policy_default(db, make_property, make_policy):
    prop = make_property()
    policy = make_policy(deductible_default=25_000)

    assert retention.get_effective_deductible(db, policy.policy_id, prop.property_id) == 25_000.0


def test_effective_deductible_unknown_policy_returns_zero(db, make_property):
    prop = make_property()
    assert retention.get_effective_deductible(db, 999_999, prop.property_id) == 0.0


def test_suggest_for_incident_returns_none_for_unknown_incident(db):
    assert retention.suggest_for_incident(db, 999_999) is None


def test_suggest_for_incident_returns_none_when_no_active_policy(db, make_property, make_incident):
    prop = make_property()
    incident = make_incident(prop.property_id, initial_estimated_loss=50_000)

    assert retention.suggest_for_incident(db, incident.incident_id) is None


def test_suggest_for_incident_uses_incidents_estimated_loss_and_active_policy(db, make_property, make_policy, make_incident):
    prop = make_property()
    policy = make_policy(deductible_default=10_000, status="ACTIVE")
    from app import models
    db.add(models.PolicyAsset(policy_id=policy.policy_id, property_id=prop.property_id))
    db.commit()
    incident = make_incident(prop.property_id, initial_estimated_loss=80_000)

    result = retention.suggest_for_incident(db, incident.incident_id)

    assert result is not None
    assert result["incident_id"] == incident.incident_id
    assert result["policy_id"] == policy.policy_id
    assert result["estimated_loss"] == 80_000.0


def test_suggest_for_incident_ignores_expired_policy(db, make_property, make_policy, make_incident):
    """get_active_policy_for_property filters on status == ACTIVE — an EXPIRED
    policy attached via Policy_Assets must not be picked up as coverage."""
    prop = make_property()
    policy = make_policy(deductible_default=10_000, status="EXPIRED")
    from app import models
    db.add(models.PolicyAsset(policy_id=policy.policy_id, property_id=prop.property_id))
    db.commit()
    incident = make_incident(prop.property_id, initial_estimated_loss=80_000)

    assert retention.suggest_for_incident(db, incident.incident_id) is None
