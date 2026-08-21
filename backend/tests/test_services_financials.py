"""Unit tests for app/services/financials.py — multi-year trend ratios, trend summary
(CAGR), and the Solvency-style regulatory report. Previously uncovered (TODO_SPEC.md §9,
"בדיקות Backend")."""
from datetime import date

from app import models
from app.services import financials


def _statement(year: int, **overrides) -> models.FinancialStatement:
    defaults = dict(
        statement_id=year, year=year, total_assets=100_000_000, revenue=20_000_000,
        net_income=2_000_000, insurance_expense=1_000_000,
    )
    defaults.update(overrides)
    return models.FinancialStatement(**defaults)


def test_calculate_multi_year_trends_empty_is_empty_list(db):
    assert financials.calculate_multi_year_trends(db) == []


def test_calculate_multi_year_trends_computes_ratios_and_growth(db, make_property, make_policy):
    db.add(_statement(2023, revenue=10_000_000, net_income=1_000_000, insurance_expense=500_000, total_assets=50_000_000))
    db.add(_statement(2024, revenue=20_000_000, net_income=2_000_000, insurance_expense=1_000_000, total_assets=50_000_000))
    db.commit()

    # A policy that spans both years counts its full annual_premium in each year touched.
    make_policy(annual_premium=200_000, start_date=date(2023, 6, 1), end_date=date(2024, 6, 1))

    trends = financials.calculate_multi_year_trends(db)
    assert [t["year"] for t in trends] == [2023, 2024]

    first, second = trends
    assert first["premium_paid"] == 200_000
    assert second["premium_paid"] == 200_000
    assert first["revenue_growth_pct"] is None  # nothing to compare against
    assert second["revenue_growth_pct"] == 100.0  # 10M -> 20M
    assert first["insurance_expense_to_revenue"] == 0.05
    assert second["net_income_margin"] == 0.1


def test_calculate_multi_year_trends_includes_claim_losses_and_loss_ratio(db, make_property, make_policy, make_incident, make_claim):
    db.add(_statement(2024, revenue=10_000_000, total_assets=40_000_000))
    db.commit()

    prop = make_property()
    policy = make_policy(annual_premium=100_000, start_date=date(2024, 1, 1), end_date=date(2024, 12, 31))
    incident = make_incident(prop.property_id)
    claim = make_claim(incident.incident_id, policy.policy_id, claimed_amount=80_000, approved_amount=80_000)
    db.add(models.ClaimPayment(payment_id=1, claim_id=claim.claim_id, payment_date=date(2024, 5, 1), amount=80_000, payment_type="FULL"))
    db.commit()

    trends = financials.calculate_multi_year_trends(db)
    row = trends[0]
    assert row["claim_losses_paid"] == 80_000
    assert row["premium_paid"] == 100_000
    assert row["loss_ratio"] == 0.8
    assert row["losses_to_asset_value"] == round(80_000 / 40_000_000, 4)


def test_calculate_multi_year_trends_handles_nullable_balance_sheet_fields(db):
    db.add(_statement(2024, total_liabilities=None, total_equity=None, gross_profit=None, operating_profit=None))
    db.commit()

    row = financials.calculate_multi_year_trends(db)[0]
    assert row["total_liabilities"] is None
    assert row["total_equity"] is None
    assert row["gross_margin"] is None
    assert row["operating_margin"] is None
    assert row["equity_ratio"] is None


def test_calculate_trend_summary_none_with_fewer_than_two_years(db):
    db.add(_statement(2024))
    db.commit()
    assert financials.calculate_trend_summary(db) is None


def test_calculate_trend_summary_none_with_no_statements(db):
    assert financials.calculate_trend_summary(db) is None


def test_calculate_trend_summary_computes_cagr_and_outpacing_flag(db):
    db.add(_statement(2022, revenue=10_000_000, insurance_expense=500_000, net_income=1_000_000, total_assets=40_000_000))
    db.add(_statement(2024, revenue=12_100_000, insurance_expense=900_000, net_income=1_200_000, total_assets=42_000_000))
    db.commit()

    summary = financials.calculate_trend_summary(db)
    assert summary["years_covered"] == [2022, 2024]
    assert summary["revenue_cagr_pct"] == 10.0  # 10M -> 12.1M over 2 years = 10% CAGR
    # insurance_expense grew far faster than revenue -> cost of risk is outpacing revenue.
    assert summary["cost_of_risk_outpacing_revenue"] is True


def test_build_regulatory_report_no_statements_has_null_solvency_ratio(db):
    report = financials.build_regulatory_report(db, seed=42)
    assert report["reporting_year"] is None
    assert report["capital_adequacy"]["eligible_own_funds"] is None
    assert report["capital_adequacy"]["solvency_ratio_percent"] is None
    assert report["capital_adequacy"]["status"] == "לא ניתן לחשב"
    assert report["multi_year_trends"] == []
    assert report["trend_summary"] is None


def test_build_regulatory_report_uses_total_equity_and_flags_status_bands(db, make_property, make_risk_profile):
    prop = make_property(replacement_value=5_000_000)
    make_risk_profile(prop.property_id, mfl_amount=1_000_000)
    # Huge equity relative to any plausible VaR from a tiny one-property portfolio ->
    # solvency ratio comfortably clears the 150% "target capital" band.
    db.add(_statement(2024, total_equity=500_000_000, total_assets=600_000_000))
    db.commit()

    report = financials.build_regulatory_report(db, seed=42)
    assert report["reporting_year"] == 2024
    assert report["capital_adequacy"]["eligible_own_funds"] == 500_000_000
    assert report["capital_adequacy"]["status"] == "יעד הון מולא"
    assert report["capital_adequacy"]["solvency_ratio_percent"] > 150.0
    assert report["concentration_disclosure"]["total_insured_value"] == 5_000_000
    assert report["concentration_disclosure"]["maximum_foreseeable_loss"] == 1_000_000
    assert report["concentration_disclosure"]["concentration_percent"] == 20.0


def test_build_regulatory_report_falls_back_to_total_assets_when_equity_missing(db, make_property, make_risk_profile):
    prop = make_property()
    make_risk_profile(prop.property_id)
    db.add(_statement(2024, total_equity=None, total_assets=90_000_000))
    db.commit()

    report = financials.build_regulatory_report(db, seed=1)
    assert report["capital_adequacy"]["eligible_own_funds"] == 90_000_000
