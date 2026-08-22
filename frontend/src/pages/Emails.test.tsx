/**
 * Component tests for Emails.tsx — the inbox list render (sender/subject/date),
 * bold-vs-normal weight for unread vs. read rows, folder switching via
 * EmailSidebar, and that clicking a row fetches the thread detail and marks
 * the message read.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchEmailsMock, fetchEmailThreadMock, markEmailReadMock, fetchEmailAttachmentSignedUrlMock } = vi.hoisted(
  () => ({
    fetchEmailsMock: vi.fn(),
    fetchEmailThreadMock: vi.fn(),
    markEmailReadMock: vi.fn(),
    fetchEmailAttachmentSignedUrlMock: vi.fn(),
  }),
);

vi.mock("../api/client", () => ({
  fetchEmails: fetchEmailsMock,
  fetchEmailThread: fetchEmailThreadMock,
  markEmailRead: markEmailReadMock,
  fetchEmailAttachmentSignedUrl: fetchEmailAttachmentSignedUrlMock,
}));

import Emails from "./Emails";

const SENDER = { user_id: 2, full_name: "דנה כהן", role: "RISK_MANAGER" };
const RECIPIENT_USER = { user_id: 1, full_name: "יוסי לוי", role: "PROPERTY_MANAGER" };

const UNREAD_ITEM = {
  email_id: 10,
  subject: "עדכון דחוף",
  created_at: "2026-08-20T10:00:00Z",
  sender: SENDER,
  thread_id: null,
  is_read: false,
  folder: "INBOX",
};
const READ_ITEM = {
  email_id: 11,
  subject: "סטטוס שבועי",
  created_at: "2026-08-19T09:00:00Z",
  sender: SENDER,
  thread_id: null,
  is_read: true,
  folder: "INBOX",
};

const THREAD_MESSAGE = {
  email_id: 10,
  subject: "עדכון דחוף",
  body_html: "<p>שלום, <b>יש</b> עדכון.</p>",
  created_at: "2026-08-20T10:00:00Z",
  status: "SENT",
  thread_id: null,
  sender: SENDER,
  recipients: [{ user: RECIPIENT_USER, recipient_type: "TO", is_read: false, folder: "INBOX" }],
  attachments: [],
};
const THREAD = { root: THREAD_MESSAGE, messages: [THREAD_MESSAGE] };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Emails />, { wrapper });
}

describe("Emails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchEmailsMock.mockImplementation((folder: string) =>
      Promise.resolve(folder === "INBOX" ? [UNREAD_ITEM, READ_ITEM] : []),
    );
    fetchEmailThreadMock.mockResolvedValue(THREAD);
    markEmailReadMock.mockResolvedValue({ user: RECIPIENT_USER, recipient_type: "TO", is_read: true, folder: "INBOX" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the inbox list with sender, subject and date", async () => {
    renderPage();
    expect(await screen.findByText("עדכון דחוף")).toBeInTheDocument();
    expect(screen.getByText("סטטוס שבועי")).toBeInTheDocument();
    expect(screen.getAllByText("דנה כהן").length).toBeGreaterThan(0);
  });

  it("shows unread rows bold and read rows at normal weight", async () => {
    renderPage();
    const unreadRow = await screen.findByTestId("email-row-10");
    const readRow = screen.getByTestId("email-row-11");

    expect(within(unreadRow).getByText("עדכון דחוף")).toHaveStyle({ fontWeight: "700" });
    expect(within(readRow).getByText("סטטוס שבועי")).toHaveStyle({ fontWeight: "400" });
  });

  it("clicking a row fetches the thread detail and marks it read", async () => {
    renderPage();
    const row = await screen.findByTestId("email-row-10");
    await userEvent.click(row);

    expect(fetchEmailThreadMock).toHaveBeenCalledWith(10);
    expect(markEmailReadMock).toHaveBeenCalledWith(10, true);
    expect(await screen.findByText(/שלום, יש עדכון\./)).toBeInTheDocument();
  });

  it("clicking an already-read row fetches the thread but does not re-mark it read", async () => {
    renderPage();
    const row = await screen.findByTestId("email-row-11");
    await userEvent.click(row);

    expect(fetchEmailThreadMock).toHaveBeenCalledWith(11);
    expect(markEmailReadMock).not.toHaveBeenCalled();
  });

  it("switching folders via the sidebar re-fetches the list for that folder", async () => {
    renderPage();
    await screen.findByText("עדכון דחוף");
    await userEvent.click(screen.getByTestId("email-folder-SENT"));

    expect(await screen.findByText("אין הודעות בתיקייה זו.")).toBeInTheDocument();
    expect(fetchEmailsMock).toHaveBeenCalledWith("SENT");
  });
});
