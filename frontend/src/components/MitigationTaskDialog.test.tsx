/**
 * MitigationTaskDialog's status and amount rules, matching routers/mitigation.py:
 * OVERDUE isn't a choice (the backend derives it from the due date), a COMPLETED
 * task's status is locked (reopening is refused), amounts can't be negative, and a
 * failed save shows the backend's reason.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateMitigationTaskMock } = vi.hoisted(() => ({ updateMitigationTaskMock: vi.fn() }));

vi.mock("../api/client", () => ({
  createMitigationTask: vi.fn(),
  fetchProperties: vi.fn().mockResolvedValue([]),
  fetchUsers: vi.fn().mockResolvedValue([]),
  updateMitigationTask: updateMitigationTaskMock,
}));

import type { MitigationTask } from "../api/client";
import MitigationTaskDialog from "./MitigationTaskDialog";

const TASK: MitigationTask = {
  task_id: 1,
  property_id: 1,
  title: "התקנת מתזים",
  cost_estimate: 100_000,
  expected_annual_savings: 20_000,
  due_date: "2030-12-01",
  status: "OPEN",
  assigned_to_user_id: null,
  roi_percent: 20,
};

function renderDialog(task: MitigationTask) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<MitigationTaskDialog open task={task} onClose={() => {}} />, { wrapper });
}

describe("MitigationTaskDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("doesn't offer OVERDUE as a status choice", async () => {
    renderDialog(TASK);
    await userEvent.click(screen.getByRole("combobox", { name: "סטטוס" }));
    const options = within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["פתוחה", "בטיפול", "הושלמה"]);
  });

  it("shows an overdue task's status as derived, not choosable", async () => {
    renderDialog({ ...TASK, status: "OVERDUE", due_date: "2020-01-01" });
    expect(screen.getByText('"באיחור" נקבע אוטומטית לפי תאריך היעד')).toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox", { name: "סטטוס" }));
    expect(within(screen.getByRole("listbox")).getByRole("option", { name: "באיחור" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("locks the status of a completed task", () => {
    renderDialog({ ...TASK, status: "COMPLETED" });
    expect(screen.getByRole("combobox", { name: "סטטוס" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("משימה שהושלמה היא סופית")).toBeInTheDocument();
  });

  it("blocks a negative cost or savings amount", () => {
    renderDialog(TASK);
    fireEvent.change(screen.getByLabelText("עלות משוערת (₪)"), { target: { value: "-1" } });
    expect(screen.getByText("יש להזין סכום אפס ומעלה")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שמירה" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("עלות משוערת (₪)"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "שמירה" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("חיסכון שנתי צפוי (₪)"), { target: { value: "-5" } });
    expect(screen.getByRole("button", { name: "שמירה" })).toBeDisabled();
  });

  it("shows the backend's reason when saving fails", async () => {
    const config = { headers: {} } as InternalAxiosRequestConfig;
    const response = {
      data: { detail: "משימה שהושלמה היא סופית — לא ניתן לפתוח אותה מחדש" },
      status: 400,
      statusText: "",
      headers: {},
      config,
    } as AxiosResponse;
    updateMitigationTaskMock.mockRejectedValue(new AxiosError("400", "ERR_BAD_REQUEST", config, null, response));
    renderDialog(TASK);
    await userEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("משימה שהושלמה היא סופית — לא ניתן לפתוח אותה מחדש")).toBeInTheDocument();
  });
});
