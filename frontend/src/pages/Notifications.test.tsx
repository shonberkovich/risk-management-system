/**
 * Component tests for Notifications.tsx — the two-tier role gate (canRead:
 * RISK_MANAGER/CFO/ADMIN for the whole page, canManageRecipients: ADMIN-only
 * for the recipients CRUD actions), the dispatch confirm flow, and the empty
 * "no active threshold alerts" banner.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  previewNotificationsMock,
  fetchNotificationLogMock,
  fetchNotificationRecipientsMock,
  dispatchNotificationsMock,
  deleteNotificationRecipientMock,
  useAuthMock,
} = vi.hoisted(() => ({
  previewNotificationsMock: vi.fn(),
  fetchNotificationLogMock: vi.fn(),
  fetchNotificationRecipientsMock: vi.fn(),
  dispatchNotificationsMock: vi.fn(),
  deleteNotificationRecipientMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  previewNotifications: previewNotificationsMock,
  fetchNotificationLog: fetchNotificationLogMock,
  fetchNotificationRecipients: fetchNotificationRecipientsMock,
  dispatchNotifications: dispatchNotificationsMock,
  deleteNotificationRecipient: deleteNotificationRecipientMock,
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));
vi.mock("../components/NotificationRecipientDialog", () => ({ default: () => null }));

import Notifications from "./Notifications";

const RECIPIENT = {
  recipient_id: 1,
  role: "RISK_MANAGER",
  display_name: "דנה כהן",
  email: "dana@x.com",
  phone: "050-1234567",
  channels: ["EMAIL"],
  min_severity: "warning",
  is_active: true,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Notifications />, { wrapper });
}

describe("Notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewNotificationsMock.mockResolvedValue([]);
    fetchNotificationLogMock.mockResolvedValue([]);
    fetchNotificationRecipientsMock.mockResolvedValue([RECIPIENT]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows an access-denied message for FIELD_WORKER and never fetches anything", () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "FIELD_WORKER" } });
    renderPage();
    expect(screen.getByText(/זמין למנהלי סיכונים/)).toBeInTheDocument();
    expect(previewNotificationsMock).not.toHaveBeenCalled();
    expect(fetchNotificationRecipientsMock).not.toHaveBeenCalled();
  });

  it("CFO can read the page but does not see recipient management controls", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "CFO" } });
    renderPage();
    expect(await screen.findByText("דנה כהן")).toBeInTheDocument();
    expect(screen.queryByText("נמען חדש")).not.toBeInTheDocument();
    expect(screen.queryByText("פעולות")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("עריכה")).not.toBeInTheDocument();
  });

  it("ADMIN sees recipient management controls", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();
    expect(await screen.findByText("דנה כהן")).toBeInTheDocument();
    expect(screen.getByText("נמען חדש")).toBeInTheDocument();
    expect(screen.getByText("פעולות")).toBeInTheDocument();
    expect(screen.getByLabelText("עריכה")).toBeInTheDocument();
  });

  it("shows the all-clear banner when there are no active alerts", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "RISK_MANAGER" } });
    renderPage();
    expect(await screen.findByText("אין כרגע התראות סף פעילות הממתינות לניתוב.")).toBeInTheDocument();
  });

  it("dispatch is disabled with no active alerts, even for a read-allowed role", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "RISK_MANAGER" } });
    renderPage();
    await screen.findByText("אין כרגע התראות סף פעילות הממתינות לניתוב.");
    expect(screen.getByText("שליחה עכשיו").closest("button")).toBeDisabled();
  });

  it("confirming dispatch calls dispatchNotifications and shows the sent-count alert", async () => {
    previewNotificationsMock.mockResolvedValue([
      { recipient_role: "RISK_MANAGER", recipient_name: "דנה כהן", channel: "EMAIL", contact: "dana@x.com", alert_type: "critical_incident", severity: "critical", title: "כותרת ההתראה", message: "x", property_ids: [1], value: 1, threshold: 1, status: null },
    ]);
    dispatchNotificationsMock.mockResolvedValue([{ recipient_role: "RISK_MANAGER" }]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "RISK_MANAGER" } });
    renderPage();

    // Wait for the preview table row to actually render (not just the button's
    // static label) before asserting the button's now-enabled state — the
    // button itself is present from first render, just disabled until then.
    await screen.findByText("אירוע קריטי");
    const sendButton = screen.getByText("שליחה עכשיו");
    expect(sendButton.closest("button")).not.toBeDisabled();
    await userEvent.click(sendButton);

    expect(window.confirm).toHaveBeenCalled();
    expect(dispatchNotificationsMock).toHaveBeenCalled();
    expect(await screen.findByText(/נשלחו 1 התראות/)).toBeInTheDocument();
  });

  it("canceling the dispatch confirm does not call dispatchNotifications", async () => {
    previewNotificationsMock.mockResolvedValue([
      { recipient_role: "RISK_MANAGER", recipient_name: "דנה כהן", channel: "EMAIL", contact: "dana@x.com", alert_type: "critical_incident", severity: "critical", title: "כותרת ההתראה", message: "x", property_ids: [1], value: 1, threshold: 1, status: null },
    ]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();

    await userEvent.click(await screen.findByText("שליחה עכשיו"));

    expect(dispatchNotificationsMock).not.toHaveBeenCalled();
  });
});
