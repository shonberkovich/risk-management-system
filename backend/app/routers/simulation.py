from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import schemas
from app.database import get_db
from app.services import simulation

router = APIRouter(prefix="/api/simulation", tags=["simulation"])

MAX_ITERATIONS = 100_000
MAX_HORIZON_YEARS = 50
# The work is iterations x horizon_years simulated years (x the number of properties),
# all in pure Python on the request thread, and these endpoints are open to any caller.
# Each bound alone still allowed 100,000 x 50 — about 100 s of a busy server for a
# 30-property portfolio — so the product is capped at what 100,000 single-year runs
# already cost (a few seconds): e.g. 100,000 runs for 1 year, 2,000 runs for 50.
MAX_SIMULATED_YEARS = 100_000
SIMULATION_TOO_LARGE_DETAIL = (
    "מספר ההרצות כפול שנות האופק מוגבל ל-100,000 (למשל 100,000 הרצות לשנה אחת, או 2,000 הרצות ל-50 שנה)"
)


def _check_workload(iterations: int, horizon_years: int) -> None:
    if iterations * horizon_years > MAX_SIMULATED_YEARS:
        raise HTTPException(422, SIMULATION_TOO_LARGE_DETAIL)


@router.get("/portfolio", response_model=schemas.PortfolioSimulationResult)
def run_portfolio_simulation(
    iterations: int = Query(simulation.DEFAULT_ITERATIONS, gt=0, le=MAX_ITERATIONS),
    horizon_years: int = Query(1, gt=0, le=MAX_HORIZON_YEARS),
    seed: int | None = None,
    db: Session = Depends(get_db),
):
    """Monte Carlo portfolio loss simulation: expected cumulative loss over
    horizon_years, worst simulated horizon, VaR95/VaR99, and a histogram of the full
    simulated distribution for charting. See services/simulation.py for the full
    model (per-property event probability/severity, no cross-property correlation)."""
    _check_workload(iterations, horizon_years)
    return simulation.run_portfolio_simulation(
        db, iterations=iterations, horizon_years=horizon_years, seed=seed
    )


@router.get("/properties/{property_id}", response_model=schemas.PropertySimulationResult)
def run_property_simulation(
    property_id: int,
    iterations: int = Query(simulation.DEFAULT_ITERATIONS, gt=0, le=MAX_ITERATIONS),
    horizon_years: int = Query(1, gt=0, le=MAX_HORIZON_YEARS),
    seed: int | None = None,
    db: Session = Depends(get_db),
):
    """Same Monte Carlo simulation, scoped to a single property. 404 if the property
    doesn't exist or has no risk profile to simulate against (see
    services/simulation.py::simulate_property)."""
    _check_workload(iterations, horizon_years)
    result = simulation.simulate_property(
        db, property_id, iterations=iterations, horizon_years=horizon_years, seed=seed
    )
    if result is None:
        raise HTTPException(404, "Property not found or has no risk profile")
    return result
