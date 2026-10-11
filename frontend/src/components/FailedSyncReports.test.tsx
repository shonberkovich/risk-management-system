/**
 * FailedSyncReports — lists offline-queued reports the server rejected, with the server's
 * reason, and lets the user retry or (after confirming) discard each one.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getFailedReports: vi.fn(),
  retryQueuedReport: vi.fn(),
  discardQueuedReport: vi.fn(),
}));

vi.mock("../offline/syncQueue", () => ({
  getFailedReports: mocks.getFailedReports,
  retryQueuedReport: mocks.retryQueuedReport,
  discardQueuedReport: mocks.discardQueuedReport,
  // Fires once on subscribe, like the real one.
  subscribeToSyncQueue: (listener: (s: unknown) => void) => {
    listener({ pendingCount: 0, failedCount: 1, syncing: false });
    return () => undefined;
  },
}));

import FailedSyncReports from "./FailedSyncReports";

const FAILED = {
  id: 3,
  queuedAt: "2026-10-11T08:00:00Z",
  failed: true,
  lastError: "לא ניתן לערוך אירוע שכבר הוגש",
  operation: { kind: "draft-submit", draftId: 42, payload: { description: "צינור פרוץ במחסן" }, files: [] },
};

describe("FailedSyncReports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.retryQueuedReport.mockResolvedValue({ succeeded: 1, failed: 0 });
    mocks.discardQueuedReport.mockResolvedValue(undefined);
  });

  it("renders nothing when no report was rejected", async () => {
    mocks.getFailedReports.mockResolvedValue([]);
    const { container } = render(<FailedSyncReports />);
    await waitFor(() => expect(mocks.getFailedReports).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows each rejected report with the server's reason", async () => {
    mocks.getFailedReports.mockResolvedValue([FAILED]);
    render(<FailedSyncReports />);

    const item = await screen.findByTestId("failed-sync-item");
    expect(within(item).getByText(/הגשת טיוטה/)).toHaveTextContent('צינור פרוץ במחסן');
    expect(within(item).getByText(/לא ניתן לערוך אירוע שכבר הוגש/)).toBeInTheDocument();
  });

  it('"נסה שוב" retries that item', async () => {
    mocks.getFailedReports.mockResolvedValue([FAILED]);
    render(<FailedSyncReports />);

    await userEvent.click(await screen.findByRole("button", { name: "נסה שוב" }));

    expect(mocks.retryQueuedReport).toHaveBeenCalledWith(3);
  });

  it('"מחק מהתור" discards it only after confirming', async () => {
    mocks.getFailedReports.mockResolvedValue([FAILED]);
    render(<FailedSyncReports />);

    await userEvent.click(await screen.findByRole("button", { name: "מחק מהתור" }));
    let dialog = await screen.findByRole("dialog", { name: "מחיקת דיווח מהתור" });
    await userEvent.click(within(dialog).getByRole("button", { name: "ביטול" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.discardQueuedReport).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "מחק מהתור" }));
    dialog = await screen.findByRole("dialog", { name: "מחיקת דיווח מהתור" });
    await userEvent.click(within(dialog).getByRole("button", { name: "מחיקה" }));
    expect(mocks.discardQueuedReport).toHaveBeenCalledWith(3);
  });
});
