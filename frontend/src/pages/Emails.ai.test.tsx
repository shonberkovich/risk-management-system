/**
 * Component tests for Emails.tsx's Task 15 AI features (TODO_SPEC.md "משימה
 * 15: סיכום מיילים ארוכים וסיווג באמצעות Claude AI"): the "סכם עם AI" summary
 * banner (loading state, dismissible, friendly 503 message) and "הצע תשובה"
 * (opens EmailComposeModal in reply mode pre-filled with the suggested
 * draft). Mirrors Emails.test.tsx's mocking setup — see that file for why
 * EmailComposeModal/EmailEntityLinkControl's own api/client dependencies also
 * need mocks even though these tests don't exercise them directly.
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
  summarizeEmailThreadMock,
  suggestEmailReplyMock,
  useAuthMock,
} = vi.hoisted(() => ({
  fetchEmailsMock: vi.fn(),
  fetchEmailThreadMock: vi.fn(),
  markEmailReadMock: vi.fn(),
  fetchEmailAttachmentSignedUrlMock: vi.fn(),
  fetchUsersMock: vi.fn(),
  sendEmailMock: vi.fn(),
  scheduleEmailMock: vi.fn(),
  uploadEmailAttachmentsMock: vi.fn(),
  fetchEmailTemplatesMock: vi.fn(),
  linkEmailToEntityMock: vi.fn(),
  fetchPropertiesMock: vi.fn(),
  fetchIncidentsMock: vi.fn(),
  fetchClaimsMock: vi.fn(),
  fetchScheduledEmailsMock: vi.fn(),
  cancelScheduledEmailMock: vi.fn(),
  summarizeEmailThreadMock: vi.fn(),
  suggestEmailReplyMock: vi.fn(),
  useAuthMock: vi.fn(),
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
  summarizeEmailThread: summarizeEmailThreadMock,
  suggestEmailReply: suggestEmailReplyMock,
}));

import Emails from "./Emails";

const SENDER = { user_id: 2, full_name: "דנה כהן", role: "RISK_MANAGER" };
const RECIPIENT_USER = { user_id: 1, full_name: "יוסי לוי", role: "PROPERTY_MANAGER" };

const INBOX_ITEM = {
  email_id: 10,
  subject: "עדכון דחוף",
  created_at: "2026-08-20T10:00:00Z",
  sender: SENDER,
  thread_id: null,
  is_read: true,
  folder: "INBOX",
};

const THREAD_MESSAGE = {
  email_id: 10,
  subject: "עדכון דחוף",
  body_html: "<p>שלום, יש עדכון.</p>",
  created_at: "2026-08-20T10:00:00Z",
  status: "SENT",
  thread_id: null,
  sender: SENDER,
  recipients: [{ user: RECIPIENT_USER, recipient_type: "TO", is_read: true, folder: "INBOX" }],
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

async function openThread() {
  renderPage();
  const row = await screen.findByTestId("email-row-10");
  await userEvent.click(row);
  await screen.findByTestId("summarize-thread-button");
}

describe("Emails — Task 15 AI features", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchEmailsMock.mockImplementation((folder: string) => Promise.resolve(folder === "INBOX" ? [INBOX_ITEM] : []));
    fetchEmailThreadMock.mockResolvedValue(THREAD);
    markEmailReadMock.mockResolvedValue({ user: RECIPIENT_USER, recipient_type: "TO", is_read: true, folder: "INBOX" });
    fetchScheduledEmailsMock.mockResolvedValue([]);
    fetchUsersMock.mockResolvedValue([SENDER, RECIPIENT_USER]);
    useAuthMock.mockReturnValue({ user: { ...RECIPIENT_USER, signature: null } });
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the summary banner after clicking 'סכם עם AI', dismissibly", async () => {
    summarizeEmailThreadMock.mockResolvedValue({ summary: "זהו סיכום קצר של השרשור." });
    await openThread();

    await userEvent.click(screen.getByTestId("summarize-thread-button"));

    expect(summarizeEmailThreadMock).toHaveBeenCalledWith(10);
    const banner = await screen.findByTestId("thread-summary-banner");
    expect(within(banner).getByText("זהו סיכום קצר של השרשור.")).toBeInTheDocument();

    // Dismissible.
    await userEvent.click(within(banner).getByRole("button"));
    await waitFor(() => expect(screen.queryByTestId("thread-summary-banner")).not.toBeInTheDocument());
  });

  it("shows a friendly message (not a raw error) when summarize returns 503", async () => {
    summarizeEmailThreadMock.mockRejectedValue({
      isAxiosError: true,
      response: { status: 503, data: { detail: "AI features are not configured" } },
    });
    await openThread();

    await userEvent.click(screen.getByTestId("summarize-thread-button"));

    const errorAlert = await screen.findByTestId("thread-summary-error");
    expect(errorAlert).toHaveTextContent("שירות ה-AI אינו מוגדר כרגע");
    expect(errorAlert).not.toHaveTextContent("AI features are not configured");
  });

  it("shows a loading state while summarizing", async () => {
    let resolveSummary: (value: { summary: string }) => void = () => {};
    summarizeEmailThreadMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSummary = resolve;
      }),
    );
    await openThread();

    const button = screen.getByTestId("summarize-thread-button");
    await userEvent.click(button);
    expect(button).toBeDisabled();
    expect(within(button).getByText("מסכם...")).toBeInTheDocument();

    resolveSummary({ summary: "סיכום." });
    await screen.findByTestId("thread-summary-banner");
    expect(button).not.toBeDisabled();
  });

  it("'הצע תשובה' opens the compose modal in reply mode pre-filled with the suggested draft", async () => {
    suggestEmailReplyMock.mockResolvedValue({ draft: "תודה על הפנייה, אעדכן בהקדם." });
    await openThread();

    await userEvent.click(screen.getByTestId("suggest-reply-button"));
    expect(suggestEmailReplyMock).toHaveBeenCalledWith(10);

    // Opens EmailComposeModal in reply mode ("תגובה" title, per its own
    // inReplyTo-driven DialogTitle) with the draft pre-filled into the body
    // and the original sender pre-filled as the recipient — editable, not sent.
    expect(await screen.findByRole("heading", { name: "תגובה" })).toBeInTheDocument();
    const body = screen.getByLabelText("תוכן ההודעה") as HTMLTextAreaElement;
    await waitFor(() => expect(body.value).toContain("תודה על הפנייה, אעדכן בהקדם."));
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(screen.getAllByText(SENDER.full_name).length).toBeGreaterThan(0);
  });

  it("shows a friendly message when suggest-reply returns 503, without opening compose", async () => {
    suggestEmailReplyMock.mockRejectedValue({
      isAxiosError: true,
      response: { status: 503, data: { detail: "AI features are not configured" } },
    });
    await openThread();

    await userEvent.click(screen.getByTestId("suggest-reply-button"));

    const errorAlert = await screen.findByTestId("suggest-reply-error");
    expect(errorAlert).toHaveTextContent("שירות ה-AI אינו מוגדר כרגע");
    expect(screen.queryByRole("heading", { name: "תגובה" })).not.toBeInTheDocument();
  });
});
