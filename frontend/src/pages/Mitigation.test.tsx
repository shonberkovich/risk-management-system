/**
 * Component test for Mitigation.tsx's write-role gate (RISK_MANAGER/
 * PROPERTY_MANAGER/ADMIN) on "משימה חדשה" and the table's edit/mark-complete
 * actions — same bug class as Policies.test.tsx: these used to be visible to
 * every authenticated role, including ones the backend's
 * _MITIGATION_WRITE_ROLES would 403 on submit.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchMitigationTasksMock,
  fetchPropertiesMock,
  fetchUsersMock,
  fetchMitigationRoiSummaryMock,
  updateMitigationTaskMock,
  useAuthMock,
  taskDialogSpy,
} =
  vi.hoisted(() => ({
    updateMitigationTaskMock: vi.fn(),
    fetchMitigationTasksMock: vi.fn(),
    fetchPropertiesMock: vi.fn(),
    fetchUsersMock: vi.fn(),
    fetchMitigationRoiSummaryMock: vi.fn(),
    useAuthMock: vi.fn(),
    taskDialogSpy: vi.fn(),
  }));

vi.mock("../api/client", () => ({
  fetchMitigationTasks: fetchMitigationTasksMock,
  fetchProperties: fetchPropertiesMock,
  fetchUsers: fetchUsersMock,
  fetchMitigationRoiSummary: fetchMitigationRoiSummaryMock,
  updateMitigationTask: updateMitigationTaskMock,
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));
vi.mock("../components/MitigationTaskDialog", () => ({
  default: (props: unknown) => {
    taskDialogSpy(props);
    return null;
  },
}));
vi.mock("../components/MitigationRoiDialog", () => ({ default: () => null }));
vi.mock("../components/MitigationReportPrintable", () => ({ default: () => null }));

import Mitigation from "./Mitigation";

const TASK = {
  task_id: 1,
  property_id: 1,
  title: "התקנת מתזים",
  cost_estimate: 100_000,
  expected_annual_savings: 20_000,
  due_date: "2026-12-01",
  status: "OPEN",
  assigned_to_user_id: null,
  roi_percent: 20,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Mitigation />, { wrapper });
}

describe("Mitigation — write-role gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMitigationTasksMock.mockResolvedValue([TASK]);
    fetchPropertiesMock.mockResolvedValue([]);
    fetchUsersMock.mockResolvedValue([]);
    fetchMitigationRoiSummaryMock.mockResolvedValue([]);
  });

  it('shows "משימה חדשה" and edit/mark-complete actions for a write role (PROPERTY_MANAGER)', async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "PROPERTY_MANAGER" } });
    renderPage();
    await screen.findByText("התקנת מתזים");
    expect(screen.getByText("משימה חדשה")).toBeInTheDocument();
    expect(screen.getByLabelText("עריכה")).toBeInTheDocument();
    expect(screen.getByLabelText("סימון כבוצע")).toBeInTheDocument();
    // Read-only ROI view stays visible regardless of write access.
    expect(screen.getByLabelText("פירוט ROI")).toBeInTheDocument();
  });

  it('hides "משימה חדשה" and edit/mark-complete for a non-write role (ADJUSTER), but keeps ROI view', async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADJUSTER" } });
    renderPage();
    await screen.findByText("התקנת מתזים");
    expect(screen.queryByText("משימה חדשה")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("עריכה")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("סימון כבוצע")).not.toBeInTheDocument();
    expect(screen.getByLabelText("פירוט ROI")).toBeInTheDocument();
  });

  it("never renders MitigationTaskDialog for a non-write role", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "FIELD_WORKER" } });
    renderPage();
    await screen.findByText("התקנת מתזים");
    expect(taskDialogSpy).not.toHaveBeenCalled();
  });
});

describe("Mitigation — mark complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMitigationTasksMock.mockResolvedValue([TASK]);
    fetchPropertiesMock.mockResolvedValue([]);
    fetchUsersMock.mockResolvedValue([]);
    fetchMitigationRoiSummaryMock.mockResolvedValue([]);
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "RISK_MANAGER" } });
  });

  it("asks first (completing is final) and only completes on confirm", async () => {
    updateMitigationTaskMock.mockResolvedValue({ ...TASK, status: "COMPLETED" });
    renderPage();
    await screen.findByText("התקנת מתזים");

    await userEvent.click(within(screen.getByLabelText("סימון כבוצע")).getByRole("button"));
    const dialog = await screen.findByRole("dialog", { name: "סימון משימה כבוצעה" });
    await userEvent.click(within(dialog).getByRole("button", { name: "ביטול" }));
    expect(updateMitigationTaskMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await userEvent.click(within(screen.getByLabelText("סימון כבוצע")).getByRole("button"));
    const again = await screen.findByRole("dialog", { name: "סימון משימה כבוצעה" });
    await userEvent.click(within(again).getByRole("button", { name: "סימון כבוצעה" }));
    await waitFor(() => expect(updateMitigationTaskMock).toHaveBeenCalledWith(1, { status: "COMPLETED" }));
  });

  it("shows why marking complete failed", async () => {
    updateMitigationTaskMock.mockRejectedValue(new Error("boom"));
    renderPage();
    await screen.findByText("התקנת מתזים");
    await userEvent.click(within(screen.getByLabelText("סימון כבוצע")).getByRole("button"));
    await userEvent.click(
      within(await screen.findByRole("dialog", { name: "סימון משימה כבוצעה" })).getByRole("button", { name: "סימון כבוצעה" }),
    );
    expect(await screen.findByText("סימון המשימה כבוצעה נכשל. נסו שוב.")).toBeInTheDocument();
  });
});
