/**
 * PropertyDetail's documents section deletes the way the Documents screen does: only
 * after an in-app confirmation, and a failed delete is reported instead of being an
 * unhandled rejection.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPropertyMock, fetchDocumentsForEntityMock, deleteDocumentMock, useAuthMock } = vi.hoisted(() => ({
  fetchPropertyMock: vi.fn(),
  fetchDocumentsForEntityMock: vi.fn(),
  deleteDocumentMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  deactivateProperty: vi.fn(),
  deleteDocument: deleteDocumentMock,
  fetchDocumentSignedUrl: vi.fn(),
  fetchDocumentsForEntity: fetchDocumentsForEntityMock,
  fetchProperty: fetchPropertyMock,
  fetchReplacementValueUpdates: vi.fn().mockResolvedValue([]),
  fetchPropertyHazmatProximity: vi.fn().mockResolvedValue([]),
  fetchEntityEmails: vi.fn().mockResolvedValue([]),
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

const DOC = { document_id: 4, entity_type: "PROPERTY", entity_id: 1, s3_url: "x", doc_type: "SURVEY_REPORT", uploaded_by: null, uploaded_at: "2026-10-01T08:00:00" };

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

describe("PropertyDetail — document delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPropertyMock.mockResolvedValue(PROPERTY);
    fetchDocumentsForEntityMock.mockResolvedValue([DOC]);
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "מנהל סיכונים", role: "RISK_MANAGER" } });
  });

  it("asks before deleting and does nothing when cancelled", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "מחק מסמך" }));
    const dialog = await screen.findByRole("dialog", { name: "מחיקת מסמך" });
    await userEvent.click(within(dialog).getByRole("button", { name: "ביטול" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deleteDocumentMock).not.toHaveBeenCalled();
  });

  it("deletes after confirming and reports a failure", async () => {
    deleteDocumentMock.mockRejectedValue(new Error("500"));
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "מחק מסמך" }));
    const dialog = await screen.findByRole("dialog", { name: "מחיקת מסמך" });
    await userEvent.click(within(dialog).getByRole("button", { name: "מחיקה" }));
    expect(deleteDocumentMock).toHaveBeenCalledWith(4);
    expect(await screen.findByText("מחיקת המסמך נכשלה. נסו שוב.")).toBeInTheDocument();
  });
});
