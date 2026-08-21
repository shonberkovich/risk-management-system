/**
 * Regression coverage for TODO_SPEC.md §14 item 3 ("תצוגת חשיפה לאינפלציה (BOI)"):
 * PropertyDetail must show the book-value vs. BOI/construction-cost-index-adjusted
 * replacement-value drift block for RISK_MANAGER/CFO/ADMIN, and must hide it entirely
 * for FIELD_WORKER — mirroring the _ECONOMICS_ROLES role set
 * backend/app/routers/integrations.py already enforces server-side, so a FIELD_WORKER
 * session never even issues the GET /api/integrations/economics/replacement-value-updates
 * request.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPropertyMock, fetchDocumentsForEntityMock, fetchReplacementValueUpdatesMock, useAuthMock } = vi.hoisted(
  () => ({
    fetchPropertyMock: vi.fn(),
    fetchDocumentsForEntityMock: vi.fn(),
    fetchReplacementValueUpdatesMock: vi.fn(),
    useAuthMock: vi.fn(),
  }),
);

vi.mock("../api/client", () => ({
  deactivateProperty: vi.fn(),
  deleteDocument: vi.fn(),
  fetchDocumentSignedUrl: vi.fn(),
  fetchDocumentsForEntity: fetchDocumentsForEntityMock,
  fetchProperty: fetchPropertyMock,
  fetchReplacementValueUpdates: fetchReplacementValueUpdatesMock,
  uploadDocument: vi.fn(),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));
vi.mock("../components/PropertyDialog", () => ({ default: () => null }));
vi.mock("../components/RiskSurveyDialog", () => ({ default: () => null }));

import PropertyDetail from "./PropertyDetail";

const PROPERTY = {
  property_id: 1,
  property_code: "PRP-001",
  name: "מרכז לוגיסטי תל אביב",
  address: "רחוב הברזל 3",
  region: "מרכז",
  latitude: 32.09,
  longitude: 34.78,
  asset_type: "WAREHOUSE",
  replacement_value: 10_000_000,
  book_value: 8_000_000,
  is_active: true,
  risk_profile: null,
  manager_name: null,
  active_policy: null,
};

const REPLACEMENT_UPDATE = {
  property_id: 1,
  property_code: "PRP-001",
  name: "מרכז לוגיסטי תל אביב",
  current_replacement_value: 10_000_000,
  suggested_replacement_value: 10_800_000,
  drift_percent: 8.0,
  baseline_date: "2024-01-01",
  as_of: "2026-08-21",
  recommended_for_revaluation: true,
  source_system: "ECON-SIM",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/properties/1"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <Routes>
      <Route path="/properties/:id" element={<PropertyDetail />} />
    </Routes>,
    { wrapper },
  );
}

describe("PropertyDetail — BOI inflation exposure block", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPropertyMock.mockResolvedValue(PROPERTY);
    fetchDocumentsForEntityMock.mockResolvedValue([]);
    fetchReplacementValueUpdatesMock.mockResolvedValue([REPLACEMENT_UPDATE]);
  });

  it("shows the drift block for RISK_MANAGER", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "מנהל סיכונים", role: "RISK_MANAGER" } });
    renderPage();

    expect(await screen.findByText(/חשיפה לאינפלציה/)).toBeInTheDocument();
    await waitFor(() => expect(fetchReplacementValueUpdatesMock).toHaveBeenCalledWith(1));
    expect(await screen.findByText("+8.0%")).toBeInTheDocument();
  });

  it("shows the drift block for CFO", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 2, full_name: "סמנכ״ל כספים", role: "CFO" } });
    renderPage();
    expect(await screen.findByText(/חשיפה לאינפלציה/)).toBeInTheDocument();
  });

  it("hides the drift block entirely for FIELD_WORKER and never calls the economics endpoint", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 3, full_name: "עובד שטח", role: "FIELD_WORKER" } });
    renderPage();

    await screen.findByText("מרכז לוגיסטי תל אביב");
    expect(screen.queryByText(/חשיפה לאינפלציה/)).not.toBeInTheDocument();
    expect(fetchReplacementValueUpdatesMock).not.toHaveBeenCalled();
  });
});
