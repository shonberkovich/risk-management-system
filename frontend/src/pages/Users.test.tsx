/**
 * Component tests for Users.tsx — the page-level ADMIN-only gate (unlike
 * Policies.tsx/Mitigation.tsx, this one was already correct: a non-ADMIN
 * never even fires the fetchUsersAdmin query), the "אני" self-badge, and
 * opening the create/edit dialog.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchUsersAdminMock, useAuthMock, userDialogSpy } = vi.hoisted(() => ({
  fetchUsersAdminMock: vi.fn(),
  useAuthMock: vi.fn(),
  userDialogSpy: vi.fn(),
}));

vi.mock("../api/client", () => ({ fetchUsersAdmin: fetchUsersAdminMock }));
vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));
vi.mock("../components/UserDialog", () => ({
  default: (props: unknown) => {
    userDialogSpy(props);
    return null;
  },
}));

import Users from "./Users";

const USERS = [
  { user_id: 1, full_name: "מנהל המערכת", email: "admin@x.com", role: "ADMIN", is_active: true, created_at: "2024-01-01T00:00:00" },
  { user_id: 2, full_name: "יוסי כהן", email: "fw@x.com", role: "FIELD_WORKER", is_active: false, created_at: "2024-02-01T00:00:00" },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Users />, { wrapper });
}

describe("Users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchUsersAdminMock.mockResolvedValue(USERS);
  });

  it("shows an access-denied message for a non-ADMIN and never calls fetchUsersAdmin", () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "RISK_MANAGER" } });
    renderPage();
    expect(screen.getByText(/זמין למנהלי מערכת/)).toBeInTheDocument();
    expect(fetchUsersAdminMock).not.toHaveBeenCalled();
  });

  it("shows an access-denied message for a null user", () => {
    useAuthMock.mockReturnValue({ user: null });
    renderPage();
    expect(screen.getByText(/זמין למנהלי מערכת/)).toBeInTheDocument();
    expect(fetchUsersAdminMock).not.toHaveBeenCalled();
  });

  it("lists users for ADMIN, with a self-badge on the current user's row", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "מנהל המערכת", role: "ADMIN" } });
    renderPage();

    expect(await screen.findByText("מנהל המערכת")).toBeInTheDocument();
    expect(screen.getByText("יוסי כהן")).toBeInTheDocument();
    expect(screen.getByText("אני")).toBeInTheDocument(); // only on the current user's row
    expect(screen.getByText("פעיל")).toBeInTheDocument();
    expect(screen.getByText("מושבת")).toBeInTheDocument();
  });

  it("shows an empty-state message when there are no users", async () => {
    fetchUsersAdminMock.mockResolvedValue([]);
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();
    expect(await screen.findByText("אין משתמשים במערכת.")).toBeInTheDocument();
  });

  it("shows an error message if the query fails", async () => {
    fetchUsersAdminMock.mockRejectedValue(new Error("network error"));
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();
    expect(await screen.findByText("שגיאה בטעינת רשימת המשתמשים.")).toBeInTheDocument();
  });

  it('opening "משתמש חדש" opens the dialog with user=null', async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "מנהל המערכת", role: "ADMIN" } });
    renderPage();
    await screen.findByText("מנהל המערכת");

    await userEvent.click(screen.getByText("משתמש חדש"));

    expect(userDialogSpy).toHaveBeenLastCalledWith(expect.objectContaining({ open: true, user: null }));
  });

  it("clicking edit on a row opens the dialog with that user", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "מנהל המערכת", role: "ADMIN" } });
    renderPage();
    await screen.findByText("יוסי כהן");

    const editButtons = screen.getAllByLabelText("עריכה");
    await userEvent.click(editButtons[1]); // second row = יוסי כהן

    expect(userDialogSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, user: expect.objectContaining({ user_id: 2 }) }),
    );
  });
});
