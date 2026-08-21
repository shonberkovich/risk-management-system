/**
 * Component tests for Claims.tsx — status filter re-fetching with the right
 * query param, the Excel export button's disabled/enabled state and click
 * behavior, and wiring ClaimsTable's onEdit/onPayments callbacks into the
 * two dialogs.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchClaimsMock, exportClaimsToExcelMock, updateDialogSpy, paymentsDialogSpy, useAuthMock } = vi.hoisted(() => ({
  fetchClaimsMock: vi.fn(),
  exportClaimsToExcelMock: vi.fn(),
  updateDialogSpy: vi.fn(),
  paymentsDialogSpy: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock("../api/client", () => ({ fetchClaims: fetchClaimsMock }));
vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));
vi.mock("../exportClaims", () => ({ exportClaimsToExcel: exportClaimsToExcelMock }));
vi.mock("../components/ClaimUpdateDialog", () => ({
  default: (props: unknown) => {
    updateDialogSpy(props);
    return null;
  },
}));
vi.mock("../components/ClaimPaymentsDialog", () => ({
  default: (props: unknown) => {
    paymentsDialogSpy(props);
    return null;
  },
}));

import Claims from "./Claims";

const CLAIM: import("../api/client").ClaimTrackingRow = {
  claim_id: 1,
  claim_number: "CLM-001",
  property_name: "מרכז לוגיסטי תל אביב",
  incident_date: "2026-01-01",
  hazard_type: "FIRE",
  claimed_amount: 100_000,
  deductible_applied: 10_000,
  approved_amount: 90_000,
  claim_status: "SUBMITTED",
  expected_payment_date: null,
  paid_amount: 0,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Claims />, { wrapper });
}

describe("Claims", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchClaimsMock.mockResolvedValue([CLAIM]);
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "RISK_MANAGER" } });
  });

  it("loads with no status filter and shows the row once resolved", async () => {
    renderPage();
    await waitFor(() => expect(fetchClaimsMock).toHaveBeenCalledWith(undefined));
    expect(await screen.findByText("CLM-001")).toBeInTheDocument();
  });

  it("changing the status filter re-fetches with that status", async () => {
    renderPage();
    await screen.findByText("CLM-001");

    await userEvent.click(screen.getByLabelText("סינון לפי סטטוס"));
    await userEvent.click(await screen.findByRole("option", { name: "אושרה" }));

    await waitFor(() => expect(fetchClaimsMock).toHaveBeenLastCalledWith("APPROVED"));
  });

  it("resetting the filter back to \"הכל\" re-fetches with no status", async () => {
    renderPage();
    await screen.findByText("CLM-001");
    await userEvent.click(screen.getByLabelText("סינון לפי סטטוס"));
    await userEvent.click(await screen.findByRole("option", { name: "אושרה" }));
    await waitFor(() => expect(fetchClaimsMock).toHaveBeenLastCalledWith("APPROVED"));

    await userEvent.click(screen.getByLabelText("סינון לפי סטטוס"));
    await userEvent.click(await screen.findByRole("option", { name: "הכל" }));

    await waitFor(() => expect(fetchClaimsMock).toHaveBeenLastCalledWith(undefined));
  });

  it("disables the export button while there is no data", async () => {
    fetchClaimsMock.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(fetchClaimsMock).toHaveBeenCalled());
    expect(screen.getByText("ייצוא ל-Excel").closest("button")).toBeDisabled();
  });

  it("clicking export calls exportClaimsToExcel with the current rows", async () => {
    renderPage();
    await screen.findByText("CLM-001");
    const exportButton = screen.getByText("ייצוא ל-Excel");
    expect(exportButton.closest("button")).not.toBeDisabled();

    await userEvent.click(exportButton);

    expect(exportClaimsToExcelMock).toHaveBeenCalledTimes(1);
    const [rows, filename] = exportClaimsToExcelMock.mock.calls[0];
    expect(rows).toEqual([CLAIM]);
    expect(filename).toMatch(/^תביעות-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("opening the edit action passes the clicked claim into ClaimUpdateDialog", async () => {
    renderPage();
    await screen.findByText("CLM-001");

    // ClaimsTable renders a real edit IconButton per row when onEdit is passed —
    // Claims.tsx wires that straight to setEditClaim.
    const editButtons = screen.getAllByRole("button").filter((b) => b.querySelector('[data-testid="EditIcon"]'));
    await userEvent.click(editButtons[0]);

    expect(updateDialogSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, claim: expect.objectContaining({ claim_id: 1 }) }),
    );
  });

  it("dialogs start closed (open=false, claim=null)", async () => {
    renderPage();
    await screen.findByText("CLM-001");
    expect(updateDialogSpy).toHaveBeenCalledWith(expect.objectContaining({ open: false, claim: null }));
    expect(paymentsDialogSpy).toHaveBeenCalledWith(expect.objectContaining({ open: false, claim: null }));
  });

  it("shows a loading indicator before the query resolves", () => {
    fetchClaimsMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelector('[role="progressbar"]')).toBeInTheDocument();
  });

  it("hides the edit action for a non-write role (FIELD_WORKER) but keeps the payments-view action", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "FIELD_WORKER" } });
    renderPage();
    await screen.findByText("CLM-001");

    expect(screen.queryByTestId("EditIcon")).not.toBeInTheDocument();
    expect(screen.getByTestId("PaymentsIcon")).toBeInTheDocument();
  });

  it("shows the edit action for a write role (ADJUSTER)", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADJUSTER" } });
    renderPage();
    await screen.findByText("CLM-001");

    expect(screen.getByTestId("EditIcon")).toBeInTheDocument();
  });
});
