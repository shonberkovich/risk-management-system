/**
 * Component tests for Policies.tsx — the summary KPI math (active-only
 * coverage/premium totals), the client-side status filter, and the write-role
 * gate (RISK_MANAGER/CFO/ADMIN) on the "פוליסה חדשה" button and the table's
 * edit/manage-assets actions — added because these controls used to be
 * visible to every authenticated role, including ones the backend's
 * _POLICIES_WRITE_ROLES would 403 on submit (see PolicyTable.tsx's onEdit/
 * onManageAssets becoming optional props for this fix).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPoliciesMock, useAuthMock, policyDialogSpy, assetsDialogSpy } = vi.hoisted(() => ({
  fetchPoliciesMock: vi.fn(),
  useAuthMock: vi.fn(),
  policyDialogSpy: vi.fn(),
  assetsDialogSpy: vi.fn(),
}));

vi.mock("../api/client", () => ({ fetchPolicies: fetchPoliciesMock }));
vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));
vi.mock("../components/PolicyDialog", () => ({
  default: (props: unknown) => {
    policyDialogSpy(props);
    return null;
  },
}));
vi.mock("../components/PolicyAssetsDialog", () => ({
  default: (props: unknown) => {
    assetsDialogSpy(props);
    return null;
  },
}));

import Policies from "./Policies";

const POLICIES = [
  {
    policy_id: 1,
    policy_number: "POL-001",
    insurer_name: "מבטח א",
    start_date: "2024-01-01",
    end_date: "2025-01-01",
    total_limit: 10_000_000,
    deductible_default: 50_000,
    annual_premium: 200_000,
    status: "ACTIVE",
    per_event_limit: null,
    bi_waiting_period_hours: null,
    exclusions: null,
  },
  {
    policy_id: 2,
    policy_number: "POL-002",
    insurer_name: "מבטח ב",
    start_date: "2023-01-01",
    end_date: "2024-01-01",
    total_limit: 5_000_000,
    deductible_default: 20_000,
    annual_premium: 80_000,
    status: "EXPIRED",
    per_event_limit: null,
    bi_waiting_period_hours: null,
    exclusions: null,
  },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Policies />, { wrapper });
}

describe("Policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPoliciesMock.mockResolvedValue(POLICIES);
  });

  it("sums coverage/premium totals over ACTIVE policies only", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();
    await screen.findByText("POL-001");
    // 1 active / 2 total; totals must exclude the EXPIRED policy entirely.
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
  });

  it("filtering by status narrows the visible rows and the count in the header", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();
    await screen.findByText("POL-001");
    expect(screen.getByText("רשימת פוליסות (2)")).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("סטטוס"));
    await userEvent.click(await screen.findByRole("option", { name: "פעילה" }));

    expect(screen.getByText("רשימת פוליסות (1)")).toBeInTheDocument();
    expect(screen.queryByText("POL-002")).not.toBeInTheDocument();
  });

  it('shows "פוליסה חדשה" and the table actions column for a write role (CFO)', async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "CFO" } });
    renderPage();
    await screen.findByText("POL-001");
    expect(screen.getByText("פוליסה חדשה")).toBeInTheDocument();
    expect(screen.getByText("פעולות")).toBeInTheDocument();
    expect(screen.getAllByLabelText("עריכת פוליסה")).toHaveLength(2);
  });

  it('hides "פוליסה חדשה" and the entire actions column for a non-write role (RISK_OFFICER)', async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "RISK_OFFICER" } });
    renderPage();
    await screen.findByText("POL-001");
    expect(screen.queryByText("פוליסה חדשה")).not.toBeInTheDocument();
    expect(screen.queryByText("פעולות")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("עריכת פוליסה")).not.toBeInTheDocument();
  });

  it("never renders PolicyDialog/PolicyAssetsDialog at all for a non-write role", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "FIELD_WORKER" } });
    renderPage();
    await screen.findByText("POL-001");
    expect(policyDialogSpy).not.toHaveBeenCalled();
    expect(assetsDialogSpy).not.toHaveBeenCalled();
  });
});
