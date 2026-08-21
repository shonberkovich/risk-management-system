/**
 * Component tests for Roles.tsx — the page-level ADMIN-only gate, filtering
 * by role, the delete confirm/cancel flow (window.confirm), and dialog wiring.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchRolePermissionsMock, deleteRolePermissionMock, useAuthMock, dialogSpy } = vi.hoisted(() => ({
  fetchRolePermissionsMock: vi.fn(),
  deleteRolePermissionMock: vi.fn(),
  useAuthMock: vi.fn(),
  dialogSpy: vi.fn(),
}));

vi.mock("../api/client", () => ({
  fetchRolePermissions: fetchRolePermissionsMock,
  deleteRolePermission: deleteRolePermissionMock,
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));
vi.mock("../components/RolePermissionDialog", () => ({
  default: (props: unknown) => {
    dialogSpy(props);
    return null;
  },
}));

import Roles from "./Roles";

const PERMISSIONS = [
  { role_permission_id: 1, role: "ADMIN", permission_key: "users:manage", description: "ניהול משתמשים" },
  { role_permission_id: 2, role: "RISK_MANAGER", permission_key: "properties:write", description: null },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Roles />, { wrapper });
}

describe("Roles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchRolePermissionsMock.mockResolvedValue(PERMISSIONS);
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows an access-denied message for a non-ADMIN and never fetches", () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "RISK_MANAGER" } });
    renderPage();
    expect(screen.getByText(/זמין למנהלי מערכת/)).toBeInTheDocument();
    expect(fetchRolePermissionsMock).not.toHaveBeenCalled();
  });

  it("lists permissions with a '-' fallback for a null description", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();
    expect(await screen.findByText("users:manage")).toBeInTheDocument();
    expect(screen.getByText("properties:write")).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument(); // null description
  });

  it("filtering by role re-fetches with that role", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();
    await screen.findByText("users:manage");

    await userEvent.click(screen.getByLabelText("סינון לפי תפקיד"));
    await userEvent.click(await screen.findByRole("option", { name: "מנהל סיכונים" }));

    expect(fetchRolePermissionsMock).toHaveBeenLastCalledWith("RISK_MANAGER");
  });

  it("confirming the delete prompt calls deleteRolePermission", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteRolePermissionMock.mockResolvedValue(undefined);
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();
    await screen.findByText("users:manage");

    await userEvent.click(screen.getAllByLabelText("מחיקה")[0]);

    expect(window.confirm).toHaveBeenCalled();
    expect(deleteRolePermissionMock.mock.calls[0][0]).toBe(1);
  });

  it("canceling the delete prompt does not call deleteRolePermission", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();
    await screen.findByText("users:manage");

    await userEvent.click(screen.getAllByLabelText("מחיקה")[0]);

    expect(window.confirm).toHaveBeenCalled();
    expect(deleteRolePermissionMock).not.toHaveBeenCalled();
  });

  it("shows an error alert if deletion fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    deleteRolePermissionMock.mockRejectedValue(new Error("network"));
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();
    await screen.findByText("users:manage");

    await userEvent.click(screen.getAllByLabelText("מחיקה")[0]);

    expect(await screen.findByText("מחיקת ההרשאה נכשלה.")).toBeInTheDocument();
  });

  it("shows an empty-state message when there are no permissions", async () => {
    fetchRolePermissionsMock.mockResolvedValue([]);
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();
    expect(await screen.findByText("לא נמצאו הרשאות תואמות.")).toBeInTheDocument();
  });

  it('opening "הרשאה חדשה" opens the dialog with permission=null', async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();
    await screen.findByText("users:manage");

    await userEvent.click(screen.getByText("הרשאה חדשה"));

    expect(dialogSpy).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, permission: null }));
  });
});
