/**
 * UserDialog's input checks and error feedback: a malformed email or a too-short
 * new password keeps "save" disabled (same rules as backend schemas.UserCreate),
 * the backend's own Hebrew detail is shown on failure (it used to always say
 * "maybe the email exists"), and the signed-in admin can't change their own
 * role or disable themselves (the backend refuses both).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createUserMock, updateUserMock } = vi.hoisted(() => ({
  createUserMock: vi.fn(),
  updateUserMock: vi.fn(),
}));

vi.mock("../api/client", () => ({ createUser: createUserMock, updateUser: updateUserMock }));

import type { UserAdmin } from "../api/client";
import UserDialog from "./UserDialog";

const ME: UserAdmin = {
  user_id: 7,
  full_name: "מנהל",
  email: "admin@example.com",
  role: "ADMIN",
  is_active: true,
  created_at: "2026-01-01T00:00:00",
};

function failure(status: number, detail: unknown): AxiosError {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response = { data: { detail }, status, statusText: "", headers: {}, config } as AxiosResponse;
  return new AxiosError(`status ${status}`, "ERR_BAD_REQUEST", config, null, response);
}

function renderDialog(props: { user?: UserAdmin | null; isSelf?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<UserDialog open user={props.user ?? null} isSelf={props.isSelf} onClose={() => {}} />, { wrapper });
}

describe("UserDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps create disabled for a malformed email and a too-short password", async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText("שם מלא"), "משתמש");
    await userEvent.type(screen.getByLabelText("אימייל"), "not-an-email");
    expect(screen.getByText("כתובת אימייל לא תקינה")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "יצירה" })).toBeDisabled();

    await userEvent.clear(screen.getByLabelText("אימייל"));
    await userEvent.type(screen.getByLabelText("אימייל"), "new@example.com");
    expect(screen.getByRole("button", { name: "יצירה" })).toBeEnabled();

    await userEvent.type(screen.getByLabelText(/^סיסמה/), "short");
    expect(screen.getByText("לפחות 8 תווים")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "יצירה" })).toBeDisabled();
  });

  it("shows the backend's Hebrew detail when saving fails", async () => {
    createUserMock.mockRejectedValue(failure(400, "כתובת האימייל כבר קיימת במערכת"));
    renderDialog();
    await userEvent.type(screen.getByLabelText("שם מלא"), "משתמש");
    await userEvent.type(screen.getByLabelText("אימייל"), "taken@example.com");
    await userEvent.click(screen.getByRole("button", { name: "יצירה" }));
    expect(await screen.findByText("כתובת האימייל כבר קיימת במערכת")).toBeInTheDocument();
    expect(createUserMock).toHaveBeenCalledWith({
      full_name: "משתמש",
      email: "taken@example.com",
      role: "FIELD_WORKER",
      password: null,
    });
  });

  it("names the field of a 422 instead of a generic message", async () => {
    updateUserMock.mockRejectedValue(
      failure(422, [{ loc: ["body", "full_name"], type: "string_too_long", msg: "...", ctx: { max_length: 100 } }]),
    );
    renderDialog({ user: { ...ME, user_id: 9, role: "CFO" } });
    await userEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("שם מלא: ארוך מדי (עד 100 תווים)")).toBeInTheDocument();
  });

  it("locks the role and the active switch when editing yourself", async () => {
    updateUserMock.mockResolvedValue(ME);
    renderDialog({ user: ME, isSelf: true });
    expect(screen.getByText("לא ניתן לשנות את התפקיד של עצמך")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "תפקיד" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("checkbox")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(updateUserMock).toHaveBeenCalled());
    expect(updateUserMock.mock.calls[0][1]).toMatchObject({ role: "ADMIN", is_active: true });
  });
});
