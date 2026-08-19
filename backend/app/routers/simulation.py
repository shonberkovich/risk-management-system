from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import schemas
from app.database import get_db
from app.services import simulation

router = APIRouter(prefix="/api/simulation", tags=["simulation"])

MAX_ITERATIONS = 100_000
MAX_HORIZON_YEARS = 50


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
    result = simulation.simulate_property(
        db, property_id, iterations=iterations, horizon_years=horizon_years, seed=seed
    )
    if result is None:
        raise HTTPException(404, "Property not found or has no risk profile")
    return result
