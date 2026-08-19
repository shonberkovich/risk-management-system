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
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models


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
