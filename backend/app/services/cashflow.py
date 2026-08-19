"""Reserve & cash-flow forecasting. Pure calculations, no LLM calls here (mirrors kpi.py).

Two data sources feed the forecast:
  - Claim_Reserves: the adjuster's running estimate of what's still owed on a claim
    (a claim can be re-reserved over time; only the most recently updated row per
    claim is "current").
  - Claims.expected_payment_date + the outstanding balance (approved_amount minus
    what's already been paid via Claim_Payments) for claims still open.

Both are surfaced separately (they measure related but distinct things — an adjuster's
reserve estimate vs. the claim's own approved/paid figures) and also combined into one
monthly forecast for the dashboard.
"""
from collections import defaultdict
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models

OPEN_CLAIM_STATUSES = {"SUBMITTED", "IN_ADJUSTMENT", "APPROVED"}


def get_current_reserves(db: Session) -> list[models.ClaimReserve]:
    """Returns one ClaimReserve per claim_id: the most recently updated reserve row
    for each claim (a claim's reserve can be revised multiple times, so older rows
    for the same claim are superseded, not additive)."""
    all_reserves = db.scalars(select(models.ClaimReserve)).all()
    latest_by_claim: dict[int, models.ClaimReserve] = {}
    for r in all_reserves:
        current = latest_by_claim.get(r.claim_id)
        if current is None or r.updated_at > current.updated_at:
            latest_by_claim[r.claim_id] = r
    return list(latest_by_claim.values())


def calculate_total_open_reserves(db: Session) -> float:
    """Sum of the current reserve_amount across all claims (see get_current_reserves)."""
    return float(sum(r.reserve_amount for r in get_current_reserves(db)))


def calculate_claim_outstanding_balance(claim: models.Claim) -> float:
    """What's still owed on a claim: approved_amount minus payments made so far.
    Claims not yet approved (approved_amount == 0) fall back to the claimed_amount,
    since that's the best available estimate of the eventual payout."""
    paid = float(sum(p.amount for p in claim.payments))
    base = float(claim.approved_amount) if claim.approved_amount else float(claim.claimed_amount)
    return max(base - paid, 0.0)


def calculate_expected_receipts_by_month(db: Session) -> list[tuple[str, float]]:
    """Outstanding balances of open claims (see calculate_claim_outstanding_balance),
    bucketed by Claims.expected_payment_date into "YYYY-MM" months. Claims with no
    expected_payment_date or a zero outstanding balance are excluded. Sorted
    ascending by month."""
    claims = db.scalars(
        select(models.Claim).where(models.Claim.claim_status.in_(OPEN_CLAIM_STATUSES))
    ).all()

    by_month: dict[str, float] = defaultdict(float)
    for c in claims:
        if not c.expected_payment_date:
            continue
        balance = calculate_claim_outstanding_balance(c)
        if balance <= 0:
            continue
        month_key = c.expected_payment_date.strftime("%Y-%m")
        by_month[month_key] += balance

    return sorted(by_month.items())


def calculate_reserves_by_month(db: Session) -> list[tuple[str, float]]:
    """Current reserve amounts (see get_current_reserves), bucketed by
    Claim_Reserves.expected_payment_date into "YYYY-MM" months. Reserves with no
    expected_payment_date are grouped under "unscheduled". Sorted ascending by
    month, with "unscheduled" last."""
    by_month: dict[str, float] = defaultdict(float)
    for r in get_current_reserves(db):
        month_key = r.expected_payment_date.strftime("%Y-%m") if r.expected_payment_date else "unscheduled"
        by_month[month_key] += float(r.reserve_amount)

    scheduled = sorted((k, v) for k, v in by_month.items() if k != "unscheduled")
    if "unscheduled" in by_month:
        scheduled.append(("unscheduled", by_month["unscheduled"]))
    return scheduled


def get_cashflow_summary(db: Session, months_ahead: int = 12) -> dict:
    """Combined cash-flow forecast for the dashboard: total open reserves, total
    expected receipts on open claims, and a merged monthly view (reserve + expected
    receipt amounts) covering the current month through months_ahead months out.
    Months already in the data but outside that window are dropped from the merged
    view, but still counted in the totals."""
    total_reserves = calculate_total_open_reserves(db)
    reserves_by_month = dict(calculate_reserves_by_month(db))
    receipts_by_month = dict(calculate_expected_receipts_by_month(db))
    total_expected_receipts = float(sum(receipts_by_month.values()))

    today = date.today()
    window_keys: list[str] = []
    year, month = today.year, today.month
    for _ in range(months_ahead):
        window_keys.append(f"{year:04d}-{month:02d}")
        month += 1
        if month > 12:
            month = 1
            year += 1

    monthly = [
        {
            "month": key,
            "expected_receipts": round(receipts_by_month.get(key, 0.0), 2),
            "open_reserves": round(reserves_by_month.get(key, 0.0), 2),
        }
        for key in window_keys
        if key in receipts_by_month or key in reserves_by_month
    ]

    return {
        "total_open_reserves": round(total_reserves, 2),
        "total_expected_receipts": round(total_expected_receipts, 2),
        "unscheduled_reserves": round(reserves_by_month.get("unscheduled", 0.0), 2),
        "monthly": monthly,
    }
