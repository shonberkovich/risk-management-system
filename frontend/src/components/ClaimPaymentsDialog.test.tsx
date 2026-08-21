/**
 * Tests for ClaimPaymentsDialog's write-role gate — viewing payments stays
 * open to every role (matches the backend's public GET .../payments), but
 * the "add payment" form is only shown for claims.py's _CLAIMS_WRITE_ROLES
 * (RISK_MANAGER/CFO/ADJUSTER/ADMIN). Previously this form had no gate at
 * all, so e.g. a FIELD_WORKER opening the dialog (reachable via Claims.tsx's
 * always-visible "payments" action) would see an "add payment" button
 * guaranteed to 403 on submit.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchClaimPaymentsMock, createClaimPaymentMock, useAuthMock } = vi.hoisted(() => ({
  fetchClaimPaymentsMock: vi.fn(),
  createClaimPaymentMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  fetchClaimPayments: fetchClaimPaymentsMock,
  createClaimPayment: createClaimPaymentMock,
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));

import ClaimPaymentsDialog from "./ClaimPaymentsDialog";
import type { ClaimTrackingRow } from "../api/client";

const CLAIM: ClaimTrackingRow = {
  claim_id: 1,
  claim_number: "CLM-001",
  property_name: "x",
  incident_date: "2026-01-01",
  hazard_type: "FIRE",
  claimed_amount: 100_000,
  deductible_applied: 10_000,
  approved_amount: 90_000,
  claim_status: "APPROVED",
  expected_payment_date: null,
  paid_amount: 0,
};

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ClaimPaymentsDialog open claim={CLAIM} onClose={() => {}} />, { wrapper });
}

describe("ClaimPaymentsDialog — write-role gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchClaimPaymentsMock.mockResolvedValue([]);
  });

  it("shows the add-payment form for a write role (RISK_MANAGER) on a payable claim", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "RISK_MANAGER" } });
    renderDialog();
    expect(await screen.findByText("הוספת תשלום")).toBeInTheDocument();
  });

  it("hides the add-payment form for a non-write role (FIELD_WORKER), showing a permission message instead", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "FIELD_WORKER" } });
    renderDialog();
    expect(await screen.findByText("אין לך הרשאה לרשום תשלומים לתביעות.")).toBeInTheDocument();
    expect(screen.queryByText("הוספת תשלום")).not.toBeInTheDocument();
  });

  it("still shows the payments list/summary for a non-write role", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "FIELD_WORKER" } });
    renderDialog();
    expect(await screen.findByText("טרם נרשמו תשלומים לתביעה זו.")).toBeInTheDocument();
    expect(screen.getByText("CLM-001", { exact: false })).toBeInTheDocument();
  });

  it("a write role still sees the non-payable message on a non-payable claim (status message wins over role)", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    const draft: ClaimTrackingRow = { ...CLAIM, claim_status: "DRAFT" };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(<ClaimPaymentsDialog open claim={draft} onClose={() => {}} />, { wrapper });

    expect(await screen.findByText("ניתן לרשום תשלום רק לתביעה מאושרת או סגורה.")).toBeInTheDocument();
  });
});
