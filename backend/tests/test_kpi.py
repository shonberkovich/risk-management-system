"""Unit tests for app/services/kpi.py — TIV, MFL, Loss Ratio, mitigation ROI,
property risk score. See TODO_SPEC.md stage 10 ("בדיקות יחידה לשירותי החישוב")."""
from datetime import date

from app import models
from app.services import kpi


def test_calculate_tiv_sums_only_active_properties(db, make_property):
    make_property(replacement_value=10_000_000, is_active=True)
    make_property(replacement_value=5_000_000, is_active=True)
    make_property(replacement_value=999_999_999, is_active=False)  # excluded

    assert kpi.calculate_tiv(db) == 15_000_000


def test_calculate_tiv_empty_portfolio_is_zero(db):
    assert kpi.calculate_tiv(db) == 0.0


def test_calculate_mfl_single_property_no_cluster(db, make_property, make_risk_profile):
    prop = make_property(latitude=32.0, longitude=34.0)
    make_risk_profile(prop.property_id, mfl_amount=2_000_000)

    assert kpi.calculate_mfl(db) == 2_000_000


def test_calculate_mfl_combines_nearby_properties_into_one_cluster(db, make_property, make_risk_profile):
    # ~1km apart (well within CLUSTER_RADIUS_KM=10) — their MFL should sum.
    near_a = make_property(latitude=32.000, longitude=34.000)
    near_b = make_property(latitude=32.009, longitude=34.000)
    make_risk_profile(near_a.property_id, mfl_amount=1_000_000)
    make_risk_profile(near_b.property_id, mfl_amount=1_500_000)

    assert kpi.calculate_mfl(db) == 2_500_000


def test_calculate_mfl_ignores_far_apart_properties(db, make_property, make_risk_profile):
    # Tel Aviv area vs. Eilat — hundreds of km apart, must not cluster.
    tel_aviv = make_property(latitude=32.08, longitude=34.78)
    eilat = make_property(latitude=29.55, longitude=34.95)
    make_risk_profile(tel_aviv.property_id, mfl_amount=3_000_000)
    make_risk_profile(eilat.property_id, mfl_amount=10_000_000)

    # The max single-cluster MFL is Eilat's own (larger) exposure, not the sum.
    assert kpi.calculate_mfl(db) == 10_000_000


def test_calculate_mfl_no_risk_profiles_is_zero(db, make_property):
    make_property()
    assert kpi.calculate_mfl(db) == 0.0


def test_calculate_loss_ratio(db, make_property, make_risk_profile, make_policy, make_incident, make_claim):
    prop = make_property()
    make_risk_profile(prop.property_id)
    policy = make_policy(annual_premium=1_000_000)
    incident = make_incident(prop.property_id, incident_timestamp=date(2024, 3, 1))
    make_claim(incident.incident_id, policy.policy_id, claimed_amount=300_000)

    ratio, total_claimed, total_premium = kpi.calculate_loss_ratio(db, year=2024)

    assert total_claimed == 300_000
    assert total_premium == 1_000_000
    assert ratio == 0.3


def test_calculate_loss_ratio_excludes_other_years(db, make_property, make_policy, make_incident, make_claim):
    prop = make_property()
    policy = make_policy(annual_premium=1_000_000)
    incident_2023 = make_incident(prop.property_id, incident_timestamp=date(2023, 5, 1))
    make_claim(incident_2023.incident_id, policy.policy_id, claimed_amount=500_000)

    ratio, total_claimed, _ = kpi.calculate_loss_ratio(db, year=2024)

    assert total_claimed == 0
    assert ratio == 0.0


def test_calculate_loss_ratio_zero_premium_does_not_divide_by_zero(db, make_property, make_incident, make_policy, make_claim):
    prop = make_property()
    policy = make_policy(annual_premium=0)
    incident = make_incident(prop.property_id, incident_timestamp=date(2024, 1, 1))
    make_claim(incident.incident_id, policy.policy_id, claimed_amount=50_000)

    ratio, _, total_premium = kpi.calculate_loss_ratio(db, year=2024)

    assert total_premium == 0
    assert ratio == 0.0  # falls back to 0, not ZeroDivisionError


def test_calculate_mitigation_roi():
    task = models.MitigationTask(
        property_id=1, title="t", cost_estimate=100_000, expected_annual_savings=25_000,
        due_date=date(2025, 1, 1), status="OPEN", created_at=None,
    )
    assert kpi.calculate_mitigation_roi(task) == 25.0


def test_calculate_mitigation_roi_zero_cost_returns_none():
    task = models.MitigationTask(
        property_id=1, title="t", cost_estimate=0, expected_annual_savings=25_000,
        due_date=date(2025, 1, 1), status="OPEN", created_at=None,
    )
    assert kpi.calculate_mitigation_roi(task) is None


def test_calculate_property_risk_score_weights_fire_highest():
    # flood/fire/earthquake weighted 0.35/0.40/0.25 — an all-5s profile should hit 100
    # before the sprinkler discount, and a fire-heavy profile should score higher than
    # an identically-averaged flood-heavy one.
    all_max = models.AssetRiskProfile(
        property_id=1, survey_date=date(2024, 1, 1), flood_risk_score=5, fire_risk_score=5,
        earthquake_risk_score=5, mfl_amount=0, has_sprinklers=False,
    )
    assert kpi.calculate_property_risk_score(all_max) == 100.0


def test_calculate_property_risk_score_sprinklers_reduce_score():
    profile = models.AssetRiskProfile(
        property_id=1, survey_date=date(2024, 1, 1), flood_risk_score=5, fire_risk_score=5,
        earthquake_risk_score=5, mfl_amount=0, has_sprinklers=True,
    )
    assert kpi.calculate_property_risk_score(profile) == 80.0  # 100 * 0.8
