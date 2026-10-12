"""routers/simulation.py caps runs x horizon years (MAX_SIMULATED_YEARS): each bound
alone still let one request — on endpoints open to any caller — simulate 100,000 runs
x 50 years and hold the server for well over a minute."""
from __future__ import annotations

import pytest

from app.routers import simulation as simulation_router


@pytest.mark.parametrize(
    "path_kind,iterations,horizon",
    [("portfolio", 100_000, 2), ("portfolio", 2_001, 50), ("property", 50_000, 3)],
)
def test_runs_times_years_over_the_budget_is_422(
    client, make_property, make_risk_profile, path_kind, iterations, horizon
):
    prop = make_property()
    make_risk_profile(prop.property_id)
    path = "/api/simulation/portfolio" if path_kind == "portfolio" else f"/api/simulation/properties/{prop.property_id}"

    resp = client.get(path, params={"iterations": iterations, "horizon_years": horizon})

    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"] == simulation_router.SIMULATION_TOO_LARGE_DETAIL


@pytest.mark.parametrize("path_kind", ["portfolio", "property"])
def test_the_budget_itself_is_allowed(client, make_property, make_risk_profile, path_kind):
    prop = make_property()
    make_risk_profile(prop.property_id)
    path = "/api/simulation/portfolio" if path_kind == "portfolio" else f"/api/simulation/properties/{prop.property_id}"

    resp = client.get(path, params={"iterations": 2_000, "horizon_years": 50, "seed": 1})

    assert resp.status_code == 200, resp.text
    assert resp.json()["iterations"] == 2_000
    assert resp.json()["horizon_years"] == 50
