/**
 * Regression coverage for TODO_SPEC.md "משימה 11" step 4: PropertyDetail's
 * "תקשורת" section renders email threads linked to the property via
 * GET /api/properties/{id}/emails, and shows the empty-state message when
 * none are linked.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPropertyMock, fetchDocumentsForEntityMock, fetchEntityEmailsMock, useAuthMock } = vi.hoisted(() => ({
  fetchPropertyMock: vi.fn(),
  fetchDocumentsForEntityMock: vi.fn(),
  fetchEntityEmailsMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  deactivateProperty: vi.fn(),
  deleteDocument: vi.fn(),
  fetchDocumentSignedUrl: vi.fn(),
  fetchDocumentsForEntity: fetchDocumentsForEntityMock,
  fetchProperty: fetchPropertyMock,
  fetchReplacementValueUpdates: vi.fn().mockResolvedValue([]),
  fetchPropertyHazmatProximity: vi.fn().mockResolvedValue([]),
  fetchEntityEmails: fetchEntityEmailsMock,
  uploadDocument: vi.fn(),
  sendAgentChatMessage: vi.fn(),
  proposeMitigationTask: vi.fn(),
  confirmAgentAction: vi.fn(),
  rejectAgentAction: vi.fn(),
  createMitigationTask: vi.fn(),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));
vi.mock("../components/PropertyDialog", () => ({ default: () => null }));
vi.mock("../components/RiskSurveyDialog", () => ({ default: () => null }));

import { AIAssistantProvider } from "../components/AIAssistant/AIAssistantContext";
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

const LINKED_EMAIL = {
  email_id: 55,
  subject: "עדכון לגבי הנכס",
  created_at: "2026-08-20T09:00:00Z",
  sender: { user_id: 2, full_name: "דנה כהן", role: "RISK_MANAGER" },
  linked_by: { user_id: 2, full_name: "דנה כהן", role: "RISK_MANAGER" },
  linked_at: "2026-08-20T09:05:00Z",
  auto_linked: false,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/properties/1"]}>
        <AIAssistantProvider>{children}</AIAssistantProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <Routes>
      <Route path="/properties/:id" element={<PropertyDetail />} />
    </Routes>,
    { wrapper },
  );
}

describe("PropertyDetail — 'תקשורת' (linked emails) section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPropertyMock.mockResolvedValue(PROPERTY);
    fetchDocumentsForEntityMock.mockResolvedValue([]);
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "מנהל סיכונים", role: "RISK_MANAGER" } });
  });

  it("renders a linked email thread's subject and sender", async () => {
    fetchEntityEmailsMock.mockResolvedValue([LINKED_EMAIL]);
    renderPage();

    expect(await screen.findByText("עדכון לגבי הנכס")).toBeInTheDocument();
    expect(fetchEntityEmailsMock).toHaveBeenCalledWith("PROPERTY", 1);
    expect(screen.getByText(/דנה כהן/)).toBeInTheDocument();
  });

  it("shows the empty-state message when no threads are linked", async () => {
    fetchEntityEmailsMock.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/לא קושרו תכתובות דוא"ל לנכס זה עדיין/)).toBeInTheDocument();
  });
});
