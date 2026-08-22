/**
 * Component tests for Emails.tsx — the inbox list render (sender/subject/date),
 * bold-vs-normal weight for unread vs. read rows, folder switching via
 * EmailSidebar, and that clicking a row fetches the thread detail and marks
 * the message read.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchEmailsMock,
  fetchEmailThreadMock,
  markEmailReadMock,
  fetchEmailAttachmentSignedUrlMock,
  fetchUsersMock,
  sendEmailMock,
  scheduleEmailMock,
  uploadEmailAttachmentsMock,
  fetchEmailTemplatesMock,
  linkEmailToEntityMock,
  fetchPropertiesMock,
  fetchIncidentsMock,
  fetchClaimsMock,
  fetchScheduledEmailsMock,
  cancelScheduledEmailMock,
} = vi.hoisted(() => ({
  fetchEmailsMock: vi.fn(),
  fetchEmailThreadMock: vi.fn(),
  markEmailReadMock: vi.fn(),
  fetchEmailAttachmentSignedUrlMock: vi.fn(),
  // Emails.tsx renders EmailComposeModal (Task 8) even before it's opened, so
  // its own api/client dependencies (users/templates list + send/attach calls)
  // need a mock here too, even though this file's tests never open the
  // compose modal (Task 12: EmailComposeModal fetches the template list as
  // soon as it's open, same "fetch once open" convention as `users`).
  fetchUsersMock: vi.fn(),
  sendEmailMock: vi.fn(),
  scheduleEmailMock: vi.fn(),
  uploadEmailAttachmentsMock: vi.fn(),
  fetchEmailTemplatesMock: vi.fn(),
  // Task 11: the thread panel also renders EmailEntityLinkControl, which pulls
  // in its own api/client dependencies (link call + the three entity-picker
  // list fetchers) even before the user interacts with it.
  linkEmailToEntityMock: vi.fn(),
  fetchPropertiesMock: vi.fn(),
  fetchIncidentsMock: vi.fn(),
  fetchClaimsMock: vi.fn(),
  // Task 13: Emails.tsx itself fetches the scheduled-count badge unconditionally
  // (not just when ScheduledEmailsDialog is open), so this needs a mock even for
  // tests that never open that dialog.
  fetchScheduledEmailsMock: vi.fn(),
  cancelScheduledEmailMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  fetchEmails: fetchEmailsMock,
  fetchEmailThread: fetchEmailThreadMock,
  markEmailRead: markEmailReadMock,
  fetchEmailAttachmentSignedUrl: fetchEmailAttachmentSignedUrlMock,
  fetchUsers: fetchUsersMock,
  sendEmail: sendEmailMock,
  scheduleEmail: scheduleEmailMock,
  uploadEmailAttachments: uploadEmailAttachmentsMock,
  fetchEmailTemplates: fetchEmailTemplatesMock,
  linkEmailToEntity: linkEmailToEntityMock,
  fetchProperties: fetchPropertiesMock,
  fetchIncidents: fetchIncidentsMock,
  fetchClaims: fetchClaimsMock,
  fetchScheduledEmails: fetchScheduledEmailsMock,
  cancelScheduledEmail: cancelScheduledEmailMock,
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
    fetchScheduledEmailsMock.mockResolvedValue([]);
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

    // Task 10: body_html now renders as real (server-sanitized) HTML rather than
    // Task 7's plain-text-only stopgap — assert the <b> tag actually rendered as
    // markup (not just its text), proving dangerouslySetInnerHTML is in play, plus
    // the full paragraph text is intact around it.
    const bold = await screen.findByText("יש", { selector: "b" });
    expect(bold).toBeInTheDocument();
    expect(bold.closest("p")?.textContent).toBe("שלום, יש עדכון.");
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
    expect(fetchEmailsMock).toHaveBeenCalledWith("SENT", 0, 50, "");
  });

  it("debounces the search box and re-fetches the list with the query", async () => {
    renderPage();
    await screen.findByText("עדכון דחוף");
    fetchEmailsMock.mockClear();

    const input = within(screen.getByTestId("email-search-input")).getByRole("textbox");
    await userEvent.type(input, "תקציב");

    // Debounced (300ms) — must not fire once per keystroke.
    await waitFor(() => {
      expect(fetchEmailsMock).toHaveBeenCalledWith("INBOX", 0, 50, "תקציב");
    });
    expect(fetchEmailsMock).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Scheduled emails management (TODO_SPEC.md "משימה 13" step 6)
  // ---------------------------------------------------------------------------
  describe("scheduled emails", () => {
    const SCHEDULED_ITEM = {
      email_id: 20,
      subject: "עדכון עתידי",
      body_html: "<p>x</p>",
      created_at: "2026-08-20T10:00:00Z",
      scheduled_for: "2026-08-25T10:00:00Z",
      status: "SCHEDULED",
      to: [RECIPIENT_USER],
      cc: [],
      bcc: [],
    };

    it("shows a badge with the scheduled-email count next to the button", async () => {
      fetchScheduledEmailsMock.mockResolvedValue([SCHEDULED_ITEM]);
      renderPage();

      const button = await screen.findByTestId("scheduled-emails-button");
      await waitFor(() => expect(within(button).getByText("1")).toBeInTheDocument());
    });

    it("opens the scheduled-emails dialog listing pending emails, and cancels one", async () => {
      fetchScheduledEmailsMock.mockResolvedValue([SCHEDULED_ITEM]);
      renderPage();

      await userEvent.click(await screen.findByTestId("scheduled-emails-button"));

      expect(await screen.findByText("עדכון עתידי")).toBeInTheDocument();
      expect(fetchScheduledEmailsMock).toHaveBeenCalled();

      fetchScheduledEmailsMock.mockResolvedValue([]);
      await userEvent.click(screen.getByLabelText("ביטול תזמון: עדכון עתידי"));

      await waitFor(() => expect(cancelScheduledEmailMock).toHaveBeenCalledWith(20));
      expect(await screen.findByText("אין מיילים המתוזמנים לשליחה עתידית.")).toBeInTheDocument();
    });

    it("shows an empty state when there are no scheduled emails", async () => {
      fetchScheduledEmailsMock.mockResolvedValue([]);
      renderPage();

      await userEvent.click(await screen.findByTestId("scheduled-emails-button"));
      expect(await screen.findByText("אין מיילים המתוזמנים לשליחה עתידית.")).toBeInTheDocument();
    });
  });
});
