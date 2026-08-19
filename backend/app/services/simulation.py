"""Monte Carlo loss simulation and Value-at-Risk (VaR). Pure calculations, no LLM
calls here (mirrors kpi.py / cashflow.py / retention.py).

The core question this answers: over the next year, how much total loss should the
portfolio expect, and how bad could a "bad" year plausibly get? We can't know the
future, so instead we simulate many possible years:

  - For each property, per simulated year, we flip a weighted coin for "does a loss
    event happen at this property this year?" — weighted by the property's composite
    risk score (see kpi.calculate_property_risk_score).
  - If an event happens, its severity is drawn from a triangular distribution bounded
    by the property's Maximum Foreseeable Loss (Asset_Risk_Profiles.mfl_amount) — most
    events are partial losses, not the full MFL, so the distribution peaks well below
    the maximum rather than being drawn uniformly.
  - Summing all property outcomes gives one simulated year's total portfolio loss.
    Repeating this thousands of times builds an empirical loss distribution, from
    which we read off Value-at-Risk: "the loss we expect to exceed only (1 - C%) of
    the time," for confidence levels C.

This is a teaching-grade actuarial simplification, not a real Monte Carlo pricing
engine — no event correlation (e.g. between geographically clustered properties, see
kpi._geographic_clusters), no year-over-year trend, and the probability/severity
models below are documented, fixed assumptions rather than fitted distributions (this
is a course demo — see docs/README.md §8, which explicitly scopes out real actuarial
modeling).
"""
import random
import statistics
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.services.kpi import calculate_property_risk_score

DEFAULT_ITERATIONS = 10_000

# A property with the maximum possible composite risk score (100, see
# kpi.calculate_property_risk_score) is assumed to have this probability of at least
# one loss event in a given year; probability scales linearly down to 0 with the score.
MAX_ANNUAL_EVENT_PROBABILITY = 0.25

# When an event occurs, its severity (as a fraction of the property's MFL) is drawn
# from a triangular distribution with this mode — i.e. the single most likely outcome
# is a loss equal to this fraction of MFL, with a long tail up to the full MFL and a
# floor of 0. Reflects that most incidents are partial losses, not total losses.
SEVERITY_MODE_FRACTION = 0.30

VAR_CONFIDENCE_LEVELS = (0.95, 0.99)


@dataclass
class _PropertyExposure:
    property_id: int
    event_probability: float
    mfl_amount: float


def _get_property_exposures(db: Session) -> list[_PropertyExposure]:
    """One exposure entry per active property that has a risk profile (properties
    without a survey have no basis for a probability/severity estimate and are
    excluded, same as _geographic_clusters in kpi.py)."""
    rows = db.execute(
        select(models.Property, models.AssetRiskProfile)
        .join(models.AssetRiskProfile, models.AssetRiskProfile.property_id == models.Property.property_id)
        .where(models.Property.is_active == True)  # noqa: E712
    ).all()

    exposures = []
    for _prop, profile in rows:
        risk_score = calculate_property_risk_score(profile)
        probability = (risk_score / 100.0) * MAX_ANNUAL_EVENT_PROBABILITY
        exposures.append(_PropertyExposure(
            property_id=profile.property_id,
            event_probability=probability,
            mfl_amount=float(profile.mfl_amount),
        ))
    return exposures


def _sample_event_loss(mfl_amount: float, rng: random.Random) -> float:
    """One severity draw for a property that had an event this simulated year:
    triangular(low=0, high=mfl_amount, mode=SEVERITY_MODE_FRACTION * mfl_amount)."""
    if mfl_amount <= 0:
        return 0.0
    mode = mfl_amount * SEVERITY_MODE_FRACTION
    return rng.triangular(0.0, mfl_amount, mode)


def _percentile(sorted_values: list[float], pct: float) -> float:
    """Value at the given percentile (0-1) of an already-ascending-sorted list, used
    as the VaR readout: VaR at confidence C is the loss value at the C-th percentile
    of the simulated loss distribution."""
    if not sorted_values:
        return 0.0
    idx = min(int(pct * len(sorted_values)), len(sorted_values) - 1)
    return sorted_values[idx]


def run_portfolio_simulation(
    db: Session, iterations: int = DEFAULT_ITERATIONS, seed: int | None = None
) -> dict:
    """Runs the Monte Carlo simulation across the whole portfolio and summarizes the
    resulting loss distribution: expected (mean) annual loss, worst simulated year,
    and VaR at each level in VAR_CONFIDENCE_LEVELS.

    seed is optional and only useful for reproducible/deterministic runs (e.g. tests);
    omit it for a fresh random draw each call.
    """
    exposures = _get_property_exposures(db)
    rng = random.Random(seed)

    yearly_totals: list[float] = []
    for _ in range(iterations):
        total = 0.0
        for exp in exposures:
            if rng.random() < exp.event_probability:
                total += _sample_event_loss(exp.mfl_amount, rng)
        yearly_totals.append(total)

    yearly_totals.sort()
    mean_loss = statistics.fmean(yearly_totals) if yearly_totals else 0.0

    var_by_confidence = {
        f"var_{int(level * 100)}": round(_percentile(yearly_totals, level), 2)
        for level in VAR_CONFIDENCE_LEVELS
    }

    return {
        "iterations": iterations,
        "properties_simulated": len(exposures),
        "expected_annual_loss": round(mean_loss, 2),
        "worst_case_simulated_loss": round(yearly_totals[-1], 2) if yearly_totals else 0.0,
        **var_by_confidence,
    }


def simulate_property(
    db: Session, property_id: int, iterations: int = DEFAULT_ITERATIONS, seed: int | None = None
) -> dict | None:
    """Same simulation, scoped to a single property. Returns None if the property has
    no risk profile to simulate against."""
    profile = db.scalars(
        select(models.AssetRiskProfile).where(models.AssetRiskProfile.property_id == property_id)
    ).first()
    if profile is None:
        return None

    risk_score = calculate_property_risk_score(profile)
    probability = (risk_score / 100.0) * MAX_ANNUAL_EVENT_PROBABILITY
    mfl_amount = float(profile.mfl_amount)
    rng = random.Random(seed)

    yearly_losses = [
        _sample_event_loss(mfl_amount, rng) if rng.random() < probability else 0.0
        for _ in range(iterations)
    ]
    yearly_losses.sort()
    mean_loss = statistics.fmean(yearly_losses) if yearly_losses else 0.0

    var_by_confidence = {
        f"var_{int(level * 100)}": round(_percentile(yearly_losses, level), 2)
        for level in VAR_CONFIDENCE_LEVELS
    }

    return {
        "property_id": property_id,
        "iterations": iterations,
        "annual_event_probability": round(probability, 4),
        "mfl_amount": round(mfl_amount, 2),
        "expected_annual_loss": round(mean_loss, 2),
        "worst_case_simulated_loss": round(yearly_losses[-1], 2) if yearly_losses else 0.0,
        **var_by_confidence,
    }
