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
  useAuthMock,
  fetchLabelsMock,
  createLabelMock,
  deleteLabelMock,
  addLabelToEmailMock,
  removeLabelFromEmailMock,
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
  // TODO_SPEC.md "משימה 14": EmailComposeModal now reads the signed-in user's
  // signature via useAuth() as soon as it mounts (see comment above on why it's
  // already mounted here even in tests that never open it).
  useAuthMock: vi.fn(),
  // TODO_SPEC.md "משימה 16": EmailSidebar fetches the labels list unconditionally
  // (needed for the "תגיות" nav section), and each row's overflow menu / the
  // sidebar's create/delete controls call the rest of these.
  fetchLabelsMock: vi.fn(),
  createLabelMock: vi.fn(),
  deleteLabelMock: vi.fn(),
  addLabelToEmailMock: vi.fn(),
  removeLabelFromEmailMock: vi.fn(),
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));

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
  fetchLabels: fetchLabelsMock,
  createLabel: createLabelMock,
  deleteLabel: deleteLabelMock,
  addLabelToEmail: addLabelToEmailMock,
  removeLabelFromEmail: removeLabelFromEmailMock,
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
  labels: [],
};
const READ_ITEM = {
  email_id: 11,
  subject: "סטטוס שבועי",
  created_at: "2026-08-19T09:00:00Z",
  sender: SENDER,
  thread_id: null,
  is_read: true,
  folder: "INBOX",
  labels: [],
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
  labels: [],
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
    useAuthMock.mockReturnValue({ user: { ...RECIPIENT_USER, signature: null } });
    fetchLabelsMock.mockResolvedValue([]);
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
    expect(fetchEmailsMock).toHaveBeenCalledWith("SENT", 0, 50, "", null);
  });

  it("debounces the search box and re-fetches the list with the query", async () => {
    renderPage();
    await screen.findByText("עדכון דחוף");
    fetchEmailsMock.mockClear();

    const input = within(screen.getByTestId("email-search-input")).getByRole("textbox");
    await userEvent.type(input, "תקציב");

    // Debounced (300ms) — must not fire once per keystroke.
    await waitFor(() => {
      expect(fetchEmailsMock).toHaveBeenCalledWith("INBOX", 0, 50, "תקציב", null);
    });
    expect(fetchEmailsMock).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Custom Folders / Labels (TODO_SPEC.md "משימה 16")
  // ---------------------------------------------------------------------------
  describe("labels", () => {
    const URGENT_LABEL = { id: 5, name: "דחוף", color: "#e53935" };

    it("selecting a label in the sidebar filters the list, composing with the active folder", async () => {
      fetchLabelsMock.mockResolvedValue([URGENT_LABEL]);
      renderPage();
      await screen.findByText("עדכון דחוף");
      fetchEmailsMock.mockClear();

      const labelEl = await screen.findByTestId("email-label-5");
      await userEvent.click(labelEl);

      await waitFor(() => expect(fetchEmailsMock).toHaveBeenCalledWith("INBOX", 0, 50, "", 5));
      expect(labelEl).toHaveClass("Mui-selected");

      // Clicking the same label again clears the filter (back to the
      // no-label-filter query — same key as the initial mount, so it's
      // already cached/fresh and doesn't necessarily re-fetch; the visible
      // effect is the label no longer showing as the active filter).
      await userEvent.click(labelEl);
      await waitFor(() => expect(labelEl).not.toHaveClass("Mui-selected"));
    });

    it("applying a label from the list row's overflow menu calls addLabelToEmail", async () => {
      fetchLabelsMock.mockResolvedValue([URGENT_LABEL]);
      addLabelToEmailMock.mockResolvedValue({ id: 1, email_id: 10, label: URGENT_LABEL });
      renderPage();
      await screen.findByText("עדכון דחוף");

      await userEvent.click(screen.getByTestId("email-row-menu-10"));
      const menuItem = await screen.findByTestId("label-menu-item-10-5");
      await userEvent.click(menuItem);

      expect(addLabelToEmailMock).toHaveBeenCalledWith(10, 5);
      // Opening the menu and picking a label must not also open the thread/mark it read.
      expect(fetchEmailThreadMock).not.toHaveBeenCalled();
      expect(markEmailReadMock).not.toHaveBeenCalled();
    });

    it("picking an already-applied label from the overflow menu removes it", async () => {
      fetchLabelsMock.mockResolvedValue([URGENT_LABEL]);
      removeLabelFromEmailMock.mockResolvedValue(undefined);
      fetchEmailsMock.mockImplementation((folder: string) =>
        Promise.resolve(folder === "INBOX" ? [{ ...UNREAD_ITEM, labels: [URGENT_LABEL] }, READ_ITEM] : []),
      );
      renderPage();
      await screen.findByText("עדכון דחוף");

      await userEvent.click(screen.getByTestId("email-row-menu-10"));
      const menuItem = await screen.findByTestId("label-menu-item-10-5");
      await userEvent.click(menuItem);

      expect(removeLabelFromEmailMock).toHaveBeenCalledWith(10, 5);
      expect(addLabelToEmailMock).not.toHaveBeenCalled();
    });

    it("shows the label chip on a tagged row", async () => {
      fetchLabelsMock.mockResolvedValue([URGENT_LABEL]);
      fetchEmailsMock.mockImplementation((folder: string) =>
        Promise.resolve(folder === "INBOX" ? [{ ...UNREAD_ITEM, labels: [URGENT_LABEL] }, READ_ITEM] : []),
      );
      renderPage();

      const row = await screen.findByTestId("email-row-10");
      expect(within(row).getByText("דחוף")).toBeInTheDocument();
    });
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
