/**
 * Component tests for Simulation.tsx — running a portfolio vs. a per-property
 * simulation with the right params, the initial hint / error states, and the
 * results KPI cards.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPropertiesMock, fetchPortfolioSimulationMock, fetchPropertySimulationMock } = vi.hoisted(() => ({
  fetchPropertiesMock: vi.fn(),
  fetchPortfolioSimulationMock: vi.fn(),
  fetchPropertySimulationMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  fetchProperties: fetchPropertiesMock,
  fetchPortfolioSimulation: fetchPortfolioSimulationMock,
  fetchPropertySimulation: fetchPropertySimulationMock,
}));
vi.mock("../components/SimulationDistributionChart", () => ({ default: () => <div>chart</div> }));

import Simulation from "./Simulation";

const PROPERTIES = [{ property_id: 7, name: "מרכז לוגיסטי תל אביב" }];

const PORTFOLIO_RESULT = {
  iterations: 10000,
  horizon_years: 1,
  properties_simulated: 12,
  expected_annual_loss: 500_000,
  worst_case_simulated_loss: 3_000_000,
  var_95: 1_200_000,
  var_99: 2_000_000,
  distribution: [],
};

const PROPERTY_RESULT = {
  property_id: 7,
  iterations: 10000,
  horizon_years: 1,
  annual_event_probability: 0.1,
  mfl_amount: 1_000_000,
  expected_annual_loss: 50_000,
  worst_case_simulated_loss: 900_000,
  var_95: 200_000,
  var_99: 500_000,
  distribution: [],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Simulation />, { wrapper });
}

describe("Simulation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPropertiesMock.mockResolvedValue(PROPERTIES);
  });

  it("shows the initial hint before any run", async () => {
    renderPage();
    expect(await screen.findByText(/בחר היקף ולחץ "הרץ סימולציה"/)).toBeInTheDocument();
  });

  it("running with the default portfolio scope calls fetchPortfolioSimulation, not fetchPropertySimulation", async () => {
    fetchPortfolioSimulationMock.mockResolvedValue(PORTFOLIO_RESULT);
    renderPage();
    await userEvent.click(screen.getByText("הרץ סימולציה"));

    expect(await screen.findByText("₪500K")).toBeInTheDocument();
    expect(fetchPortfolioSimulationMock).toHaveBeenCalledWith({ iterations: 10000, horizon_years: 1 });
    expect(fetchPropertySimulationMock).not.toHaveBeenCalled();
    expect(screen.getByText(/12 נכסים/)).toBeInTheDocument();
  });

  it("selecting a specific property and running calls fetchPropertySimulation with its id", async () => {
    fetchPropertySimulationMock.mockResolvedValue(PROPERTY_RESULT);
    renderPage();
    await screen.findByText(/בחר היקף/);

    await userEvent.click(screen.getByLabelText("היקף"));
    await userEvent.click(await screen.findByRole("option", { name: "מרכז לוגיסטי תל אביב" }));
    await userEvent.click(screen.getByText("הרץ סימולציה"));

    expect(await screen.findByText("₪50K")).toBeInTheDocument();
    expect(fetchPropertySimulationMock).toHaveBeenCalledWith(7, { iterations: 10000, horizon_years: 1 });
    expect(fetchPortfolioSimulationMock).not.toHaveBeenCalled();
    // Property-scoped result has no "properties_simulated" field, so that
    // suffix must not appear in the distribution card's caption.
    expect(screen.queryByText(/\d+ נכסים\)/)).not.toBeInTheDocument();
  });

  it("shows an error alert when the simulation query fails", async () => {
    fetchPortfolioSimulationMock.mockRejectedValue(new Error("500"));
    renderPage();
    await userEvent.click(screen.getByText("הרץ סימולציה"));

    expect(await screen.findByText(/שגיאה בהרצת הסימולציה/)).toBeInTheDocument();
  });

  it("disables the run button and shows a spinner label while fetching", async () => {
    fetchPortfolioSimulationMock.mockReturnValue(new Promise(() => {}));
    renderPage();
    await userEvent.click(screen.getByText("הרץ סימולציה"));

    expect(await screen.findByText("מריץ סימולציה...")).toBeInTheDocument();
    expect(screen.getByText("מריץ סימולציה...").closest("button")).toBeDisabled();
  });
});
