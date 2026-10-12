/**
 * The claim dialogs apply routers/claims.py's rules before submitting and show its
 * reason when it refuses: FileClaimDialog keeps the deductible within the claim,
 * ClaimUpdateDialog offers only forward statuses and bounds the approved amount (a
 * cleared field no longer saves 0), ClaimPaymentsDialog keeps a payment within the
 * approved balance and today, and none of them carries an old error into a new opening.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClaim: vi.fn(),
  updateClaim: vi.fn(),
  fetchEligiblePolicies: vi.fn(),
  fetchClaimPayments: vi.fn(),
  createClaimPayment: vi.fn(),
}));

vi.mock("../api/client", () => mocks);
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { user_id: 1, full_name: "דנה", role: "RISK_MANAGER" } }),
}));

import type { ClaimTrackingRow, Incident } from "../api/client";
import { claimStatusOptions } from "../format";
import ClaimPaymentsDialog from "./ClaimPaymentsDialog";
import ClaimUpdateDialog from "./ClaimUpdateDialog";
import FileClaimDialog from "./FileClaimDialog";

function apiError(status: number, detail: unknown) {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response = { data: { detail }, status, statusText: "", headers: {}, config } as AxiosResponse;
  return new AxiosError(String(status), "ERR_BAD_REQUEST", config, null, response);
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const CLAIM: ClaimTrackingRow = {
  claim_id: 1,
  claim_number: "CLM-001",
  property_name: "x",
  incident_date: "2026-01-01T10:00:00",
  hazard_type: "FIRE",
  claimed_amount: 100_000,
  deductible_applied: 0,
  approved_amount: 0,
  claim_status: "DRAFT",
  expected_payment_date: null,
  paid_amount: 0,
};

describe("claimStatusOptions", () => {
  it("only moves forward, settles only after approval, and rejects only unpaid claims", () => {
    expect(claimStatusOptions("DRAFT", 0)).toEqual(["DRAFT", "SUBMITTED", "IN_ADJUSTMENT", "APPROVED", "REJECTED"]);
    expect(claimStatusOptions("IN_ADJUSTMENT", 0)).toEqual(["IN_ADJUSTMENT", "APPROVED", "REJECTED"]);
    expect(claimStatusOptions("APPROVED", 0)).toEqual(["APPROVED", "REJECTED", "SETTLED"]);
    expect(claimStatusOptions("APPROVED", 500)).toEqual(["APPROVED", "SETTLED"]);
    expect(claimStatusOptions("SETTLED", 500)).toEqual(["SETTLED"]);
  });
});

describe("ClaimUpdateDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers only the statuses the claim can move to", async () => {
    render(<ClaimUpdateDialog open claim={{ ...CLAIM, claim_status: "IN_ADJUSTMENT" }} onClose={() => {}} />, { wrapper });
    await userEvent.click(screen.getByRole("combobox", { name: "סטטוס" }));
    const options = within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["בבירור שמאים", "אושרה", "נדחתה"]);
  });

  it("blocks a cleared, negative or too-large approved amount instead of saving 0", () => {
    render(<ClaimUpdateDialog open claim={CLAIM} onClose={() => {}} />, { wrapper });
    const field = screen.getByLabelText("סכום מאושר (₪)");
    const save = screen.getByRole("button", { name: "שמירה" });

    fireEvent.change(field, { target: { value: "" } });
    expect(save).toBeDisabled();
    fireEvent.change(field, { target: { value: "-1" } });
    expect(save).toBeDisabled();
    fireEvent.change(field, { target: { value: "100001" } });
    expect(screen.getByText("הסכום המאושר לא יכול לעלות על הסכום הנתבע")).toBeInTheDocument();
    expect(save).toBeDisabled();
    fireEvent.change(field, { target: { value: "50000" } });
    expect(save).toBeEnabled();
  });

  it("shows the backend's reason and starts the next opening clean", async () => {
    mocks.updateClaim.mockRejectedValue(apiError(400, "הסכום המאושר חורג מגבול האחריות של הפוליסה"));
    const { rerender } = render(<ClaimUpdateDialog open claim={CLAIM} onClose={() => {}} />, { wrapper });
    await userEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("הסכום המאושר חורג מגבול האחריות של הפוליסה")).toBeInTheDocument();

    rerender(<ClaimUpdateDialog open claim={{ ...CLAIM, claim_id: 2, claim_number: "CLM-002" }} onClose={() => {}} />);
    expect(screen.queryByText("הסכום המאושר חורג מגבול האחריות של הפוליסה")).not.toBeInTheDocument();
  });
});

const INCIDENT = { incident_id: 5, incident_code: "INC-005", initial_estimated_loss: 12_000 } as Incident;

describe("FileClaimDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchEligiblePolicies.mockResolvedValue([{ policy_id: 3, policy_number: "POL-3", insurer_name: "הפניקס" }]);
  });

  async function pickPolicy() {
    await userEvent.click(await screen.findByRole("combobox", { name: "פוליסה מכסה" }));
    await userEvent.click(await screen.findByRole("option", { name: "POL-3 — הפניקס" }));
  }

  it("blocks a deductible above the claimed amount", async () => {
    render(<FileClaimDialog open incident={INCIDENT} onClose={() => {}} />, { wrapper });
    await pickPolicy();
    const submit = screen.getByRole("button", { name: "פתח תביעה" });
    expect(submit).toBeEnabled();

    fireEvent.change(screen.getByLabelText("השתתפות עצמית (₪)"), { target: { value: "20000" } });
    expect(screen.getByText("ההשתתפות העצמית לא יכולה לעלות על הסכום הנתבע")).toBeInTheDocument();
    expect(submit).toBeDisabled();
  });

  it("shows the backend's reason for refusing the claim", async () => {
    mocks.createClaim.mockRejectedValue(apiError(400, "מועד האירוע אינו בתקופת הכיסוי של הפוליסה"));
    render(<FileClaimDialog open incident={INCIDENT} onClose={() => {}} />, { wrapper });
    await pickPolicy();
    await userEvent.click(screen.getByRole("button", { name: "פתח תביעה" }));
    expect(await screen.findByText("מועד האירוע אינו בתקופת הכיסוי של הפוליסה")).toBeInTheDocument();
  });
});

describe("ClaimPaymentsDialog — payment rules", () => {
  const APPROVED = { ...CLAIM, claim_status: "APPROVED" as const, approved_amount: 50_000 };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchClaimPayments.mockResolvedValue([
      { payment_id: 1, claim_id: 1, payment_date: "2026-02-01", amount: 85, reference_number: null, payment_type: "ADVANCE" },
    ]);
  });

  it("is titled for what it does (payments) and blocks an amount above the balance", async () => {
    render(<ClaimPaymentsDialog open claim={APPROVED} onClose={() => {}} />, { wrapper });
    expect(screen.getByText("תשלומים — CLM-001")).toBeInTheDocument();
    const amount = await screen.findByLabelText("סכום (₪)");
    fireEvent.change(screen.getByLabelText("תאריך תשלום"), { target: { value: "2026-02-02" } });
    fireEvent.change(amount, { target: { value: "100000" } });
    expect(screen.getByText(/הסכום חורג מהיתרה לתשלום/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הוספת תשלום" })).toBeDisabled();

    fireEvent.change(amount, { target: { value: "49915" } });
    expect(screen.getByRole("button", { name: "הוספת תשלום" })).toBeEnabled();
  });

  it("blocks a payment dated before the incident", async () => {
    render(<ClaimPaymentsDialog open claim={APPROVED} onClose={() => {}} />, { wrapper });
    fireEvent.change(await screen.findByLabelText("תאריך תשלום"), { target: { value: "2025-12-31" } });
    expect(screen.getByText("מועד התשלום לא יכול להיות לפני מועד האירוע")).toBeInTheDocument();
  });

  it("shows the backend's reason when the payment is refused", async () => {
    mocks.createClaimPayment.mockRejectedValue(apiError(400, "סכום התשלום חורג מהסכום המאושר לתביעה"));
    render(<ClaimPaymentsDialog open claim={APPROVED} onClose={() => {}} />, { wrapper });
    fireEvent.change(await screen.findByLabelText("תאריך תשלום"), { target: { value: "2026-02-02" } });
    fireEvent.change(screen.getByLabelText("סכום (₪)"), { target: { value: "100" } });
    await userEvent.click(screen.getByRole("button", { name: "הוספת תשלום" }));
    expect(await screen.findByText("סכום התשלום חורג מהסכום המאושר לתביעה")).toBeInTheDocument();
  });
});
