/**
 * Tests for EmailComposeModal (TODO_SPEC.md "משימה 8"): opening the modal,
 * filling recipients/subject/body, adding + removing a pending attachment via
 * the file-input fallback (jsdom can't fire real OS drag-and-drop, but the
 * component's onDrop handler is exercised directly with a synthetic
 * DataTransfer-shaped event — same code path a real drop takes), a successful
 * send calling sendEmail then uploadEmailAttachments in order, and an error
 * path (attachment upload failing after the email itself was sent) that keeps
 * the modal open with the pending attachment still listed instead of losing it.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchUsersMock, sendEmailMock, uploadEmailAttachmentsMock, fetchEmailTemplatesMock } = vi.hoisted(() => ({
  fetchUsersMock: vi.fn(),
  sendEmailMock: vi.fn(),
  uploadEmailAttachmentsMock: vi.fn(),
  fetchEmailTemplatesMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  fetchUsers: fetchUsersMock,
  sendEmail: sendEmailMock,
  uploadEmailAttachments: uploadEmailAttachmentsMock,
  fetchEmailTemplates: fetchEmailTemplatesMock,
}));

import EmailComposeModal from "./EmailComposeModal";

const USERS = [
  { user_id: 1, full_name: "יוסי כהן", role: "RISK_MANAGER" },
  { user_id: 2, full_name: "דנה לוי", role: "CFO" },
];

const TEMPLATES = [
  {
    id: 1,
    name: "דרישת מסמכים משמאי",
    subject_template: "בקשה למסמכים - תביעה {{claim_number}}",
    body_template: "שלום {{client_name}}, אנא שלחו את המסמכים עבור תביעה {{claim_number}}.",
    created_by: 1,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: 2,
    name: "עדכון סטטוס תביעה",
    subject_template: "עדכון סטטוס - {{claim_number}}",
    body_template: "שלום, מצורף עדכון סטטוס.",
    created_by: 1,
    created_at: "2026-01-01T00:00:00Z",
  },
];

function renderModal(props: Partial<React.ComponentProps<typeof EmailComposeModal>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const onClose = vi.fn();
  const utils = render(<EmailComposeModal open onClose={onClose} {...props} />, { wrapper });
  return { ...utils, onClose, client };
}

// Clicks to open the dropdown and picks the option by its accessible name, rather
// than typing the name character-by-character to filter down to it — with only two
// seed users the untyped dropdown already shows every option, and avoiding
// per-keystroke typing sidesteps flakiness from MUI Autocomplete's own re-renders
// racing with userEvent's keystroke pacing under load.
async function selectRecipient(label: string, name: string) {
  const field = screen.getByLabelText(label);
  await userEvent.click(field);
  const option = await screen.findByRole("option", { name });
  await userEvent.click(option);
}

function makeFile(name: string, content = "hello", type = "text/plain") {
  return new File([content], name, { type });
}

describe("EmailComposeModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchUsersMock.mockResolvedValue(USERS);
    fetchEmailTemplatesMock.mockResolvedValue(TEMPLATES);
  });

  it("opens with empty fields and the send button disabled until required fields are filled", async () => {
    renderModal();
    expect(await screen.findByText("מייל חדש")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שליחה" })).toBeDisabled();
  });

  it(
    "fills recipients, subject and body, enabling send",
    async () => {
      renderModal();
      await selectRecipient("אל", "יוסי כהן");
      await userEvent.type(screen.getByLabelText("נושא"), "עדכון סטטוס תביעה");
      await userEvent.type(screen.getByLabelText("תוכן ההודעה"), "שלום, זהו עדכון.");

      expect(screen.getByText("יוסי כהן")).toBeInTheDocument(); // recipient chip
      await waitFor(() => expect(screen.getByRole("button", { name: "שליחה" })).not.toBeDisabled());
    },
    20_000,
  );

  it("adds a file via the file-input fallback and removes it again", async () => {
    renderModal();
    const file = makeFile("report.pdf", "x".repeat(10), "application/pdf");
    const input = screen.getByTestId("compose-dropzone").querySelector("input[type=file]") as HTMLInputElement;
    await userEvent.upload(input, file);

    const pending = await screen.findByTestId("compose-pending-attachments");
    expect(within(pending).getByText(/report\.pdf/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "הסרת report.pdf" }));
    expect(screen.queryByTestId("compose-pending-attachments")).not.toBeInTheDocument();
  });

  it("adds a file via a drop event on the dropzone (drag-and-drop path)", async () => {
    renderModal();
    const dropzone = screen.getByTestId("compose-dropzone");
    const file = makeFile("photo.png", "y".repeat(20), "image/png");

    fireDrop(dropzone, [file]);

    const pending = await screen.findByTestId("compose-pending-attachments");
    expect(within(pending).getByText(/photo\.png/)).toBeInTheDocument();
  });

  it(
    "sends the email then uploads pending attachments in order, then closes and resets on success",
    async () => {
      const { onClose, client } = renderModal();
      const invalidateSpy = vi.spyOn(client, "invalidateQueries");

      sendEmailMock.mockResolvedValue({ email_id: 42 });
      uploadEmailAttachmentsMock.mockResolvedValue([]);

      await selectRecipient("אל", "יוסי כהן");
      await userEvent.type(screen.getByLabelText("נושא"), "נושא הבדיקה");
      await userEvent.type(screen.getByLabelText("תוכן ההודעה"), "גוף ההודעה");

      const file = makeFile("attachment.txt");
      const input = screen.getByTestId("compose-dropzone").querySelector("input[type=file]") as HTMLInputElement;
      await userEvent.upload(input, file);

      await userEvent.click(screen.getByRole("button", { name: "שליחה" }));

      await waitFor(() => expect(sendEmailMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(uploadEmailAttachmentsMock).toHaveBeenCalledTimes(1));

      const sendOrder = sendEmailMock.mock.invocationCallOrder[0];
      const uploadOrder = uploadEmailAttachmentsMock.mock.invocationCallOrder[0];
      expect(sendOrder).toBeLessThan(uploadOrder);

      expect(sendEmailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: [1],
          subject: "נושא הבדיקה",
          body_html: expect.stringContaining("גוף ההודעה"),
        }),
      );
      expect(uploadEmailAttachmentsMock).toHaveBeenCalledWith(42, [file]);

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["emails"] });
    },
    20_000,
  );

  it(
    "on an attachment-upload failure after a successful send, keeps the modal open with an error and the pending attachment still listed (does not lose the draft or re-send)",
    async () => {
      const { onClose } = renderModal();
      sendEmailMock.mockResolvedValue({ email_id: 99 });
      uploadEmailAttachmentsMock.mockRejectedValue(new Error("network error"));

      await selectRecipient("אל", "דנה לוי");
      await userEvent.type(screen.getByLabelText("נושא"), "נושא");
      await userEvent.type(screen.getByLabelText("תוכן ההודעה"), "גוף");

      const file = makeFile("file.txt");
      const input = screen.getByTestId("compose-dropzone").querySelector("input[type=file]") as HTMLInputElement;
      await userEvent.upload(input, file);

      await userEvent.click(screen.getByRole("button", { name: "שליחה" }));

      expect(
        await screen.findByText(
          "המייל נשלח בהצלחה, אך העלאת הקבצים המצורפים נכשלה. ניתן ללחוץ שוב על 'שליחה' כדי לנסות להעלות את הקבצים בלבד.",
        ),
      ).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(await screen.findByTestId("compose-pending-attachments")).toBeInTheDocument();
      expect(screen.getByText(/file\.txt/)).toBeInTheDocument();

      // Retrying must not re-send the already-created email — only retry the upload.
      uploadEmailAttachmentsMock.mockResolvedValueOnce([]);
      await userEvent.click(screen.getByRole("button", { name: "שליחה" }));
      await waitFor(() => expect(uploadEmailAttachmentsMock).toHaveBeenCalledTimes(2));
      expect(sendEmailMock).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    },
    20_000,
  );

  it(
    "on a send failure (before any email is created), keeps the modal open with an error and does not call uploadEmailAttachments",
    async () => {
      const { onClose } = renderModal();
      sendEmailMock.mockRejectedValue(new Error("network error"));

      await selectRecipient("אל", "יוסי כהן");
      await userEvent.type(screen.getByLabelText("נושא"), "נושא");
      await userEvent.type(screen.getByLabelText("תוכן ההודעה"), "גוף");

      await userEvent.click(screen.getByRole("button", { name: "שליחה" }));

      expect(await screen.findByText("שליחת המייל נכשלה. בדקו את החיבור ונסו שוב.")).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      expect(uploadEmailAttachmentsMock).not.toHaveBeenCalled();
    },
    20_000,
  );

  it("pre-fills recipients/subject/body when opened in reply mode via initialTo/initialSubject/initialBody", async () => {
    renderModal({ initialTo: [2], initialSubject: "Re: תביעה מס' 5", initialBody: "טיוטת תשובה", inReplyTo: 7 });

    expect(await screen.findByText("תגובה")).toBeInTheDocument();
    expect(await screen.findByText("דנה לוי")).toBeInTheDocument(); // pre-filled TO chip
    expect(screen.getByLabelText("נושא")).toHaveValue("Re: תביעה מס' 5");
    expect(screen.getByLabelText("תוכן ההודעה")).toHaveValue("טיוטת תשובה");
  });

  describe("template picker (TODO_SPEC.md \"משימה 12\")", () => {
    it("opens a picker listing templates from GET /api/email-templates when 'השתמש בתבנית' is clicked", async () => {
      renderModal();
      await userEvent.click(screen.getByRole("button", { name: "השתמש בתבנית" }));

      expect(await screen.findByText("דרישת מסמכים משמאי")).toBeInTheDocument();
      expect(screen.getByText("עדכון סטטוס תביעה")).toBeInTheDocument();
    });

    it("selecting a template fills subject/body, substituting variables from templateContext", async () => {
      renderModal({ templateContext: { claim_number: "CLM-042", client_name: "חברת דוגמה" } });

      await userEvent.click(screen.getByRole("button", { name: "השתמש בתבנית" }));
      await userEvent.click(await screen.findByText("דרישת מסמכים משמאי"));

      expect(screen.getByLabelText("נושא")).toHaveValue("בקשה למסמכים - תביעה CLM-042");
      expect(screen.getByLabelText("תוכן ההודעה")).toHaveValue(
        "שלום חברת דוגמה, אנא שלחו את המסמכים עבור תביעה CLM-042.",
      );
    });

    it("leaves unresolved {{...}} placeholders visible when no matching templateContext value is supplied", async () => {
      renderModal();

      await userEvent.click(screen.getByRole("button", { name: "השתמש בתבנית" }));
      await userEvent.click(await screen.findByText("דרישת מסמכים משמאי"));

      expect(screen.getByLabelText("נושא")).toHaveValue("בקשה למסמכים - תביעה {{claim_number}}");
      expect(screen.getByLabelText("תוכן ההודעה")).toHaveValue(
        "שלום {{client_name}}, אנא שלחו את המסמכים עבור תביעה {{claim_number}}.",
      );
    });

    it("still allows editing the loaded template text before sending", async () => {
      renderModal({ templateContext: { claim_number: "CLM-042" } });

      await userEvent.click(screen.getByRole("button", { name: "השתמש בתבנית" }));
      await userEvent.click(await screen.findByText("עדכון סטטוס תביעה"));

      const subjectField = screen.getByLabelText("נושא");
      expect(subjectField).toHaveValue("עדכון סטטוס - CLM-042");

      await userEvent.type(subjectField, " - דחוף");
      expect(subjectField).toHaveValue("עדכון סטטוס - CLM-042 - דחוף");
    });
  });
});

/** Simulates a file drop without relying on jsdom's (nonexistent) native DnD support:
 * dispatches a real "drop" DOM event carrying a `dataTransfer.files` FileList-like
 * object, which is exactly what the component's onDrop handler reads. */
function fireDrop(element: Element, files: File[]) {
  const dataTransfer = { files } as unknown as DataTransfer;
  const event = new Event("drop", { bubbles: true, cancelable: true }) as unknown as { dataTransfer: DataTransfer };
  event.dataTransfer = dataTransfer;
  element.dispatchEvent(event as unknown as Event);
}
