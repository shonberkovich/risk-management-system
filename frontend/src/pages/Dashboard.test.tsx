/**
 * Component test for Dashboard.tsx's role routing: FIELD_WORKER gets
 * FieldWorkerDashboard (the reduced-scope view — no access to the financial
 * queries the executive dashboard needs, which would otherwise 403), every
 * other role gets the executive ExecutiveDashboard. FieldWorkerDashboard is
 * mocked entirely (it has its own dedicated behavior, out of this file's
 * scope) so this test only proves the routing decision itself, not either
 * dashboard's internals.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useAuthMock, fieldWorkerDashboardSpy } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  fieldWorkerDashboardSpy: vi.fn(),
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));
vi.mock("./FieldWorkerDashboard", () => ({
  default: () => {
    fieldWorkerDashboardSpy();
    return <div>דשבורד שטח (מוקאפ)</div>;
  },
}));
// ExecutiveDashboard pulls in a large query/component graph (KPIs, map, risk
// matrix, charts) that's out of scope for a routing test — everything it
// needs is mocked to resolve to an empty/loading-forever state so it doesn't
// throw, without asserting on its internals here.
vi.mock("../api/client", () => ({
  fetchKpis: vi.fn(() => new Promise(() => {})),
  fetchAlerts: vi.fn(() => new Promise(() => {})),
  fetchWeatherAlerts: vi.fn(() => new Promise(() => {})),
  fetchHomeFrontAlerts: vi.fn(() => new Promise(() => {})),
  fetchMapPoints: vi.fn(() => new Promise(() => {})),
  fetchProperties: vi.fn(() => new Promise(() => {})),
  fetchIncidents: vi.fn(() => new Promise(() => {})),
  fetchGeographicExposureClusters: vi.fn(() => new Promise(() => {})),
  fetchRiskMatrix: vi.fn(() => new Promise(() => {})),
  fetchHazardDistribution: vi.fn(() => new Promise(() => {})),
  fetchLossRatioTrend: vi.fn(() => new Promise(() => {})),
  fetchCashflowSummary: vi.fn(() => new Promise(() => {})),
  fetchClaims: vi.fn(() => new Promise(() => {})),
}));

import Dashboard from "./Dashboard";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Dashboard />, { wrapper });
}

describe("Dashboard — role routing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes FIELD_WORKER to FieldWorkerDashboard", () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "FIELD_WORKER" } });
    renderPage();
    expect(fieldWorkerDashboardSpy).toHaveBeenCalled();
    expect(screen.getByText("דשבורד שטח (מוקאפ)")).toBeInTheDocument();
  });

  it("routes every other role (e.g. RISK_MANAGER) to the executive dashboard, not FieldWorkerDashboard", () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "RISK_MANAGER" } });
    const { container } = renderPage();
    expect(fieldWorkerDashboardSpy).not.toHaveBeenCalled();
    // Executive dashboard's KPI query never resolves in this test — it should
    // still render its own loading state rather than crashing.
    expect(container.querySelector('[role="progressbar"]')).toBeInTheDocument();
  });

  it("routes an unauthenticated/null user to the executive dashboard (not FieldWorkerDashboard)", () => {
    useAuthMock.mockReturnValue({ user: null });
    renderPage();
    expect(fieldWorkerDashboardSpy).not.toHaveBeenCalled();
  });
});
