"""External economic-indices connector (inflation / construction-cost index).
Same "simulated" pattern as app/integrations/erp.py, gis.py and weather.py: no
real provider key in `backend/.env` (no Central Bureau of Statistics / Bank of
Israel API account), no outbound HTTP call.

The course brief (see docs/README.md §8, "מחבר מדדים כלכליים") asks for an
inflation / construction-cost index used to keep a property's replacement
value current — real-estate replacement cost tracks construction-input prices
(concrete, steel, labor), not the general CPI, so this module simulates BOTH
a construction-cost index and a general CPI, and uses the construction-cost
one for the actual replacement-value recommendation (CPI is returned purely
for context/comparison, the way a real index bulletin reports several series
side by side).

Design, contrasted with the other three connectors:
- Like `gis.py` (and unlike `erp.py`), this module DOES compare its simulated
  external figure against RMIS's own data and flags a disagreement — here,
  "the construction-cost index has moved more than
  `_REVALUATION_THRESHOLD_PERCENT` since this property's `updated_at`, so its
  stored `replacement_value` is probably stale" is the actual point of an
  economic-index connector, just like a flood-zone mismatch is the point of
  the GIS one.
- Like `weather.py` (and unlike `gis.py`'s purely-spatial hash), the index
  value is time-varying: it's hashed per calendar month, not per property, so
  every property shares the same index value for the same month (matching
  how a real index publishes one national number per period, not one per
  address) — deterministic and stable within a month, but genuinely different
  a year later, same as a real CPI print.
- Like both `gis.py` and `erp.py`, this module is read-only: nothing here
  writes back to `Properties.replacement_value`. The suggested revaluation is
  a recommendation for whoever consumes this endpoint (e.g. a future "apply
  revaluation" action) to act on deliberately, not something silently applied
  on every request.
"""
import hashlib
import logging
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models

logger = logging.getLogger("rmis.integrations.economics")

# Base period the simulated index series is anchored to (index = 100.0 at
# this month). Arbitrary but fixed, so growth is always measured from the
# same origin regardless of when this module is called.
_BASE_DATE = date(2020, 1, 1)

# Simulated average monthly growth, expressed in basis points (1/100 of a
# percent) — construction-input prices (concrete, steel, labor) have
# historically outpaced general CPI, hence the higher rate here.
_CONSTRUCTION_INDEX_MONTHLY_RATE_BP = 35
_CPI_MONTHLY_RATE_BP = 20

# Deterministic month-to-month jitter added on top of the compounding trend,
# in basis points, so the simulated series isn't a perfectly smooth curve
# (a real index doesn't move by exactly the same amount every month).
_NOISE_RANGE_BP = 40

# How many percentage points the construction-cost index must have moved
# since a property's `updated_at` before its replacement_value is flagged as
# a candidate for revaluation.
_REVALUATION_THRESHOLD_PERCENT = 5.0


def _stable_hash(*parts: str) -> int:
    """Deterministic, process-independent hash (unlike Python's salted built-in
    `hash()`) so the same calendar month always yields the same simulated
    index value across calls/restarts — there's no real index bulletin to ask
    twice for a period that already published."""
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def _months_between(start: date, end: date) -> int:
    return (end.year - start.year) * 12 + (end.month - start.month)


def _index_value(as_of: date, series_name: str, monthly_rate_bp: int) -> float:
    """Simulated compounding index value for `series_name` as of the month
    containing `as_of`, anchored to 100.0 at `_BASE_DATE`."""
    months = _months_between(_BASE_DATE, as_of)
    months = max(months, 0)  # never simulate a period before the base date
    trend = 100.0 * ((1 + monthly_rate_bp / 10_000) ** months)

    month_key = f"{as_of.year:04d}-{as_of.month:02d}"
    noise_bp = (_stable_hash(series_name, month_key) % (2 * _NOISE_RANGE_BP + 1)) - _NOISE_RANGE_BP
    return round(trend * (1 + noise_bp / 10_000), 4)


def fetch_index_series(as_of: date | None = None) -> dict:
    """Returns the simulated construction-cost index and CPI for the month
    containing `as_of` (default: today), plus the base period they're
    anchored to. Both are reported the way a real index bulletin publishes
    several series side by side; only the construction-cost one drives the
    replacement-value recommendation below."""
    as_of = as_of or date.today()
    construction_index = _index_value(as_of, "construction", _CONSTRUCTION_INDEX_MONTHLY_RATE_BP)
    cpi_index = _index_value(as_of, "cpi", _CPI_MONTHLY_RATE_BP)

    logger.info(
        "[SIMULATED ECONOMICS PULL] index series as_of=%s: construction=%.4f cpi=%.4f",
        as_of.isoformat(), construction_index, cpi_index,
    )
    return {
        "as_of": as_of.isoformat(),
        "base_date": _BASE_DATE.isoformat(),
        "construction_cost_index": construction_index,
        "cpi_index": cpi_index,
        "source_system": "ECON-SIM",
    }


def fetch_replacement_value_updates(
    db: Session,
    property_ids: list[int] | None = None,
    as_of: date | None = None,
) -> list[dict]:
    """For each active property, compares the simulated construction-cost
    index at the property's `updated_at` month against the index at `as_of`,
    and recommends a proportionally adjusted `replacement_value`. Flags
    `recommended_for_revaluation` when the drift exceeds
    `_REVALUATION_THRESHOLD_PERCENT`. Read-only — see module docstring for
    why nothing is written back to `Properties.replacement_value`."""
    as_of = as_of or date.today()
    current_index = _index_value(as_of, "construction", _CONSTRUCTION_INDEX_MONTHLY_RATE_BP)

    stmt = select(models.Property).where(models.Property.is_active == True)  # noqa: E712
    if property_ids:
        stmt = stmt.where(models.Property.property_id.in_(property_ids))
    properties = db.scalars(stmt.order_by(models.Property.property_id)).all()

    rows = []
    for prop in properties:
        baseline_date = prop.updated_at.date() if prop.updated_at else _BASE_DATE
        baseline_index = _index_value(baseline_date, "construction", _CONSTRUCTION_INDEX_MONTHLY_RATE_BP)

        current_value = float(prop.replacement_value)
        growth_factor = current_index / baseline_index
        suggested_value = round(current_value * growth_factor, 2)
        drift_percent = round((suggested_value - current_value) / current_value * 100, 2) if current_value else 0.0

        rows.append({
            "property_id": prop.property_id,
            "property_code": prop.property_code,
            "name": prop.name,
            "current_replacement_value": current_value,
            "suggested_replacement_value": suggested_value,
            "drift_percent": drift_percent,
            "baseline_date": baseline_date.isoformat(),
            "as_of": as_of.isoformat(),
            "recommended_for_revaluation": abs(drift_percent) > _REVALUATION_THRESHOLD_PERCENT,
            "source_system": "ECON-SIM",
            "status": "simulated_index",
        })

    flagged = sum(1 for r in rows if r["recommended_for_revaluation"])
    logger.info(
        "[SIMULATED ECONOMICS PULL] evaluated replacement-value drift for %d properties (%d flagged for revaluation)",
        len(rows), flagged,
    )
    return rows
