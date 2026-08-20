"""Unit tests for app/services/simulation.py — Monte Carlo VaR simulation.
See TODO_SPEC.md stage 10 ("בדיקות יחידה לשירותי החישוב ... VaR")."""
import pytest

from app.services import simulation


def test_run_portfolio_simulation_is_deterministic_with_seed(db, make_property, make_risk_profile):
    prop = make_property()
    make_risk_profile(prop.property_id, mfl_amount=5_000_000, flood_risk_score=4, fire_risk_score=4, earthquake_risk_score=3)

    result_a = simulation.run_portfolio_simulation(db, iterations=500, seed=42)
    result_b = simulation.run_portfolio_simulation(db, iterations=500, seed=42)

    assert result_a == result_b


def test_run_portfolio_simulation_var99_at_least_var95(db, make_property, make_risk_profile):
    prop = make_property()
    make_risk_profile(prop.property_id, mfl_amount=5_000_000)

    result = simulation.run_portfolio_simulation(db, iterations=2000, seed=1)

    # By definition VaR at a higher confidence level covers at least as much loss.
    assert result["var_99"] >= result["var_95"] >= 0
    assert result["worst_case_simulated_loss"] >= result["var_99"]
    assert result["properties_simulated"] == 1


def test_run_portfolio_simulation_no_properties_is_all_zero(db):
    result = simulation.run_portfolio_simulation(db, iterations=100, seed=1)

    assert result["properties_simulated"] == 0
    assert result["expected_annual_loss"] == 0
    assert result["var_95"] == 0
    assert result["var_99"] == 0


def test_run_portfolio_simulation_excludes_inactive_properties(db, make_property, make_risk_profile):
    prop = make_property(is_active=False)
    make_risk_profile(prop.property_id, mfl_amount=5_000_000)

    result = simulation.run_portfolio_simulation(db, iterations=100, seed=1)

    assert result["properties_simulated"] == 0


def test_run_portfolio_simulation_horizon_years_scales_expected_loss(db, make_property, make_risk_profile):
    prop = make_property()
    make_risk_profile(prop.property_id, mfl_amount=5_000_000, flood_risk_score=5, fire_risk_score=5, earthquake_risk_score=5)

    one_year = simulation.run_portfolio_simulation(db, iterations=3000, horizon_years=1, seed=7)
    three_years = simulation.run_portfolio_simulation(db, iterations=3000, horizon_years=3, seed=7)

    # Independent identical yearly draws summed over the horizon: expected loss should
    # scale roughly linearly with horizon_years (loose tolerance — two independent
    # Monte Carlo runs, not the same seeded run repeated).
    assert three_years["expected_annual_loss"] == pytest.approx(one_year["expected_annual_loss"] * 3, rel=0.2)


def test_simulate_property_returns_none_for_property_without_risk_profile(db, make_property):
    prop = make_property()
    assert simulation.simulate_property(db, prop.property_id, iterations=100, seed=1) is None


def test_simulate_property_returns_none_for_missing_property(db):
    assert simulation.simulate_property(db, 999999, iterations=100, seed=1) is None


def test_simulate_property_matches_portfolio_for_single_property_portfolio(db, make_property, make_risk_profile):
    prop = make_property()
    make_risk_profile(prop.property_id, mfl_amount=1_000_000)

    portfolio = simulation.run_portfolio_simulation(db, iterations=1000, seed=99)
    single = simulation.simulate_property(db, prop.property_id, iterations=1000, seed=99)

    assert single["expected_annual_loss"] == portfolio["expected_annual_loss"]
    assert single["var_95"] == portfolio["var_95"]
