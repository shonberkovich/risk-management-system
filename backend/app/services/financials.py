"""Multi-year financial statement analysis: trends and ratios connecting the
macro P&L (Financial_Statements) to the risk-management data (claims, premiums).
Pure calculations, no LLM calls here (mirrors kpi.py / cashflow.py / retention.py /
simulation.py).

The core question this answers: is the cost of risk (insurance premiums + retained
losses) growing faster or slower than the business itself? A CFO cares less about a
single year's loss ratio than about the multi-year trend — is insurance_expense/revenue
climbing, are claim losses outpacing asset growth, is the portfolio's overall loss
experience improving or deteriorating.

Financial_Statements holds one row per fiscal year (company-wide revenue, net income,
total assets, insurance_expense — see docs/erd.md). Claims/Claim_Payments and
Insurance_Policies are transaction-level and not tagged with a fiscal year directly, so
this module derives per-year totals from them:

  - Annual claim losses: sum of Claim_Payments.amount grouped by payment_date.year.
    Using actual payments (not claimed/approved amounts) reflects real cash outflow in
    that year, consistent with how cashflow.py projects future payments.
  - Annual premium: sum of Insurance_Policies.annual_premium for every policy whose
    [start_date, end_date] range overlaps that year. A policy spanning two calendar
    years is counted at its full annual_premium in both years it touches — a
    simplifying, documented assumption (no pro-rata proration by day), consistent with
    the fixed-assumption pattern used throughout this service layer (e.g.
    retention.PREMIUM_SURCHARGE_RATE) since this is a course demo, not a GL system.
"""
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.services import kpi, simulation


def _annual_claim_losses(db: Session) -> dict[int, float]:
    """Total Claim_Payments.amount per calendar year (by payment_date.year)."""
    payments = db.scalars(select(models.ClaimPayment)).all()
    totals: dict[int, float] = {}
    for p in payments:
        totals[p.payment_date.year] = totals.get(p.payment_date.year, 0.0) + float(p.amount)
    return totals


def _annual_premiums(db: Session) -> dict[int, float]:
    """Total annual_premium per calendar year, summed over every policy whose
    [start_date, end_date] range overlaps that year (see module docstring for the
    no-proration simplifying assumption)."""
    policies = db.scalars(select(models.InsurancePolicy)).all()
    totals: dict[int, float] = {}
    for policy in policies:
        for year in range(policy.start_date.year, policy.end_date.year + 1):
            totals[year] = totals.get(year, 0.0) + float(policy.annual_premium)
    return totals


def calculate_multi_year_trends(db: Session) -> list[dict]:
    """One row per Financial_Statements year (ascending), enriched with derived claim
    losses / premium totals and the ratios a risk manager or CFO would track:

    - insurance_expense_to_revenue: cost of insurance as a share of revenue.
    - net_income_margin: net_income / revenue.
    - losses_to_asset_value: that year's paid claim losses as a share of total_assets —
      a macro proxy for "how much of what we own did we lose this year."
    - loss_ratio: paid claim losses / premium paid that year (>1 means claims paid out
      exceeded premium in — the classic insurance loss ratio, applied here at the
      portfolio/company level rather than per-policy).
    - revenue_growth / losses_growth: year-over-year % change vs. the previous
      statement year (None for the first year, with nothing to compare against).

    Returns an empty list if no Financial_Statements rows exist.
    """
    statements = db.scalars(
        select(models.FinancialStatement).order_by(models.FinancialStatement.year)
    ).all()
    if not statements:
        return []

    claim_losses = _annual_claim_losses(db)
    premiums = _annual_premiums(db)

    trends: list[dict] = []
    prev_revenue: float | None = None
    prev_losses: float | None = None

    for stmt in statements:
        revenue = float(stmt.revenue)
        total_assets = float(stmt.total_assets)
        insurance_expense = float(stmt.insurance_expense)
        year_losses = claim_losses.get(stmt.year, 0.0)
        year_premium = premiums.get(stmt.year, 0.0)

        revenue_growth = (
            round((revenue - prev_revenue) / prev_revenue * 100, 2)
            if prev_revenue not in (None, 0)
            else None
        )
        losses_growth = (
            round((year_losses - prev_losses) / prev_losses * 100, 2)
            if prev_losses not in (None, 0)
            else None
        )

        trends.append({
            "year": stmt.year,
            "revenue": round(revenue, 2),
            "net_income": round(float(stmt.net_income), 2),
            "total_assets": round(total_assets, 2),
            "insurance_expense": round(insurance_expense, 2),
            "claim_losses_paid": round(year_losses, 2),
            "premium_paid": round(year_premium, 2),
            "insurance_expense_to_revenue": round(insurance_expense / revenue, 4) if revenue else None,
            "net_income_margin": round(float(stmt.net_income) / revenue, 4) if revenue else None,
            "losses_to_asset_value": round(year_losses / total_assets, 4) if total_assets else None,
            "loss_ratio": round(year_losses / year_premium, 4) if year_premium else None,
            "revenue_growth_pct": revenue_growth,
            "losses_growth_pct": losses_growth,
        })

        prev_revenue = revenue
        prev_losses = year_losses

    return trends


def calculate_trend_summary(db: Session) -> dict | None:
    """Portfolio-level takeaways across all available years: average ratios plus the
    overall (first-year-to-last-year) growth of revenue vs. claim losses, which
    answers the headline question — is the cost of risk growing faster than the
    business? Returns None if there are fewer than 2 years of statements (no trend to
    describe with a single year)."""
    trends = calculate_multi_year_trends(db)
    if len(trends) < 2:
        return None

    first, last = trends[0], trends[-1]
    years_span = last["year"] - first["year"]

    def _cagr(start: float, end: float) -> float | None:
        if start <= 0 or years_span <= 0:
            return None
        return round(((end / start) ** (1 / years_span) - 1) * 100, 2)

    ratios = [t["insurance_expense_to_revenue"] for t in trends if t["insurance_expense_to_revenue"] is not None]
    loss_ratios = [t["loss_ratio"] for t in trends if t["loss_ratio"] is not None]

    return {
        "years_covered": [first["year"], last["year"]],
        "revenue_cagr_pct": _cagr(first["revenue"], last["revenue"]),
        "claim_losses_cagr_pct": _cagr(first["claim_losses_paid"], last["claim_losses_paid"]) if first["claim_losses_paid"] and last["claim_losses_paid"] else None,
        "avg_insurance_expense_to_revenue": round(sum(ratios) / len(ratios), 4) if ratios else None,
        "avg_loss_ratio": round(sum(loss_ratios) / len(loss_ratios), 4) if loss_ratios else None,
        "cost_of_risk_outpacing_revenue": (
            _cagr(first["revenue"], last["revenue"]) is not None
            and _cagr(first["insurance_expense"], last["insurance_expense"]) is not None
            and _cagr(first["insurance_expense"], last["insurance_expense"]) > _cagr(first["revenue"], last["revenue"])
        ),
    }


# --- Regulatory disclosure report (Capital Market Authority / Solvency II style) -----
#
# Solvency II's Pillar 1 (and the equivalent Israeli Capital Market, Insurance and
# Savings Authority — רשות שוק ההון — capital regime it's modeled on) boils down to one
# headline ratio: Eligible Own Funds / Solvency Capital Requirement (SCR), where SCR is
# defined as the Value-at-Risk of the insurer's own funds at 99.5% confidence over one
# year. This module doesn't run an insurer's balance sheet, but the same shape applies
# to a corporate risk-management program: "if a 1-in-100-year bad year hit us, could our
# balance sheet absorb it?" We approximate:
#
#   - Eligible own funds  -> latest Financial_Statements.total_assets (a simplifying
#     proxy — a real filing would net liabilities out to shareholders' equity, but
#     total_assets is the only balance-sheet figure this schema captures; documented
#     assumption, consistent with financials.py's other simplifications).
#   - SCR                 -> simulation.run_portfolio_simulation's VaR_99 (the closest
#     analog available to Solvency II's 99.5% VaR; this schema's Monte Carlo model
#     doesn't distinguish 99% from 99.5%, so 99% is used as-is rather than manufacturing
#     false precision).
#   - Solvency ratio       = own_funds / SCR * 100, with the two-tier status band Israeli
#     regulation and Solvency II both use in spirit: below 100% is a capital breach
#     requiring a recovery plan; 100-150% covers the regulatory minimum but below the
#     "target capital" buffer regulators expect for resilience; 150%+ is adequate.
#
# Also included: TIV/MFL concentration disclosure (Pillar 3-style large-exposure
# transparency) and the multi-year trend/ratio data above, all built from data already
# on file — no new tables, no LLM calls, same as the rest of this module.

_SCR_SIMULATION_ITERATIONS = 5_000
_SOLVENCY_MINIMUM_PERCENT = 100.0
_SOLVENCY_TARGET_PERCENT = 150.0


def _solvency_status(ratio_percent: float | None) -> str:
    if ratio_percent is None:
        return "לא ניתן לחשב"
    if ratio_percent < _SOLVENCY_MINIMUM_PERCENT:
        return "הפרת דרישת הון (Breach)"
    if ratio_percent < _SOLVENCY_TARGET_PERCENT:
        return "מעל המינימום הרגולטורי, מתחת ליעד"
    return "יעד הון מולא"


def build_regulatory_report(db: Session, seed: int | None = None) -> dict:
    """Capital-adequacy-style regulatory disclosure: Solvency ratio (own funds vs. a
    VaR-based capital requirement), TIV/MFL concentration disclosure, and the
    multi-year financial trend already computed by calculate_multi_year_trends /
    calculate_trend_summary above. Read-only, same as build_iso31000_report.

    seed is optional and only useful for a reproducible/deterministic SCR simulation
    (e.g. tests); omit it for a fresh random draw each call.
    """
    trends = calculate_multi_year_trends(db)
    trend_summary = calculate_trend_summary(db)
    latest_year = trends[-1] if trends else None
    own_funds = latest_year["total_assets"] if latest_year else None

    sim = simulation.run_portfolio_simulation(db, iterations=_SCR_SIMULATION_ITERATIONS, seed=seed)
    scr = sim["var_99"]

    solvency_ratio_percent = round(own_funds / scr * 100, 1) if own_funds and scr else None

    tiv = kpi.calculate_tiv(db)
    mfl = kpi.calculate_mfl(db)
    concentration_percent = round(mfl / tiv * 100, 2) if tiv else None

    return {
        "generated_at": datetime.now().isoformat(),
        "reporting_year": latest_year["year"] if latest_year else None,
        "capital_adequacy": {
            "eligible_own_funds": own_funds,
            "solvency_capital_requirement": scr,
            "solvency_ratio_percent": solvency_ratio_percent,
            "status": _solvency_status(solvency_ratio_percent),
            "scr_confidence_level": "99%",
            "scr_simulation_iterations": _SCR_SIMULATION_ITERATIONS,
        },
        "concentration_disclosure": {
            "total_insured_value": round(tiv, 2),
            "maximum_foreseeable_loss": round(mfl, 2),
            "concentration_percent": concentration_percent,
        },
        "multi_year_trends": trends,
        "trend_summary": trend_summary,
    }
