/**
 * Documents.tsx — the delete action is only offered to the roles the backend actually
 * lets delete (RISK_MANAGER/ADMIN, routers/documents.py), and a failed delete is shown
 * instead of being swallowed. A multi-file upload goes on past a failing file, names
 * it, and still refreshes the list with the ones that went up; there's no "uploaded
 * by" picker (the backend records the caller).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  deleteDocumentMock: vi.fn(),
  uploadDocumentMock: vi.fn(),
  fetchDocumentsForEntityMock: vi.fn(),
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: mocks.useAuthMock }));
vi.mock("../api/client", () => ({
  fetchProperties: vi.fn().mockResolvedValue([{ property_id: 3, name: "מרלו\"ג מודיעין", property_code: "PRP-001" }]),
  fetchIncidents: vi.fn().mockResolvedValue([]),
  fetchClaims: vi.fn().mockResolvedValue([]),
  fetchPolicies: vi.fn().mockResolvedValue([]),
  fetchUsers: vi.fn().mockResolvedValue([]),
  fetchDocumentsForEntity: mocks.fetchDocumentsForEntityMock,
  fetchDocumentSignedUrl: vi.fn().mockResolvedValue({ url: "u", download_url: "/api/documents/download?x", storage_key: "k", expires_at: "" }),
  deleteDocument: mocks.deleteDocumentMock,
  uploadDocument: mocks.uploadDocumentMock,
}));

const DOC = { document_id: 9, entity_type: "PROPERTY", entity_id: 3, s3_url: "x", doc_type: "SURVEY_REPORT", uploaded_by: null, uploaded_at: "2026-10-01T08:00:00" };

import Documents from "./Documents";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Documents />, { wrapper });
}

async function selectProperty() {
  await userEvent.click(await screen.findByLabelText("בחרו נכס"));
  await userEvent.click(await screen.findByRole("option", { name: /מרלו"ג מודיעין/ }));
  await screen.findByText("פתיחה / הורדה");
}

describe("Documents — delete permission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchDocumentsForEntityMock.mockResolvedValue([DOC]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hides the delete action from a role the backend won't let delete", async () => {
    mocks.useAuthMock.mockReturnValue({ user: { user_id: 5, full_name: "רונית", role: "FIELD_WORKER" } });
    renderPage();
    await selectProperty();
    expect(screen.queryByRole("button", { name: "מחק מסמך" })).not.toBeInTheDocument();
  });

  it("shows it to RISK_MANAGER and reports a failed delete instead of swallowing it", async () => {
    mocks.useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "דנה", role: "RISK_MANAGER" } });
    mocks.deleteDocumentMock.mockRejectedValue(new Error("500"));
    renderPage();
    await selectProperty();

    await userEvent.click(screen.getByRole("button", { name: "מחק מסמך" }));
    const dialog = await screen.findByRole("dialog", { name: "מחיקת מסמך" });
    expect(mocks.deleteDocumentMock).not.toHaveBeenCalled(); // nothing happens before confirming
    await userEvent.click(within(dialog).getByRole("button", { name: "מחיקה" }));

    expect(mocks.deleteDocumentMock).toHaveBeenCalledWith(9);
    expect(await screen.findByText("מחיקת המסמך נכשלה. נסו שוב.")).toBeInTheDocument();
  });

  it("does nothing when the confirmation is cancelled", async () => {
    mocks.useAuthMock.mockReturnValue({ user: { user_id: 7, full_name: "אדמין", role: "ADMIN" } });
    renderPage();
    await selectProperty();

    await userEvent.click(screen.getByRole("button", { name: "מחק מסמך" }));
    const dialog = await screen.findByRole("dialog", { name: "מחיקת מסמך" });
    await userEvent.click(within(dialog).getByRole("button", { name: "ביטול" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.deleteDocumentMock).not.toHaveBeenCalled();
  });
});

describe("Documents — upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchDocumentsForEntityMock.mockResolvedValue([DOC]);
    mocks.useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "דנה", role: "RISK_MANAGER" } });
  });

  it("has no uploader picker — the backend records the signed-in user", async () => {
    renderPage();
    await selectProperty();
    expect(screen.queryByLabelText(/הועלה על ידי/)).not.toBeInTheDocument();
  });

  it("uploads the rest after a failing file, names it, and refreshes the list", async () => {
    mocks.uploadDocumentMock.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("Network Error"));
    renderPage();
    await selectProperty();
    const fetchesBefore = mocks.fetchDocumentsForEntityMock.mock.calls.length;

    const input = screen.getByText("העלאת קובץ").querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["a"], "a.pdf"), new File(["b"], "b.pdf")] } });

    expect(await screen.findByText("1 מתוך 2 קבצים לא הועלו: b.pdf — ההעלאה נכשלה")).toBeInTheDocument();
    expect(mocks.uploadDocumentMock).toHaveBeenCalledTimes(2);
    expect(mocks.uploadDocumentMock).toHaveBeenCalledWith("PROPERTY", 3, expect.any(File), expect.any(String));
    await waitFor(() => expect(mocks.fetchDocumentsForEntityMock.mock.calls.length).toBeGreaterThan(fetchesBefore));
  });
});
