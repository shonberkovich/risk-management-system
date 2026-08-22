/**
 * Tests for ProfileSettings.tsx: the TODO_SPEC.md "משימה 14" step 2 signature
 * editor, and the "משימה 17" Email Rules/Filters builder + list section it
 * grew (see ProfileSettings.tsx's EmailRulesSection docstring).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));

const { fetchEmailRulesMock, createEmailRuleMock, deleteEmailRuleMock, fetchLabelsMock } = vi.hoisted(() => ({
  fetchEmailRulesMock: vi.fn(),
  createEmailRuleMock: vi.fn(),
  deleteEmailRuleMock: vi.fn(),
  fetchLabelsMock: vi.fn(),
}));
vi.mock("../api/client", () => ({
  fetchEmailRules: fetchEmailRulesMock,
  createEmailRule: createEmailRuleMock,
  deleteEmailRule: deleteEmailRuleMock,
  fetchLabels: fetchLabelsMock,
}));

import ProfileSettings from "./ProfileSettings";

function renderProfile() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<ProfileSettings />, { wrapper });
}

const DEMO_USER = { user_id: 1, full_name: "יוסי כהן", role: "RISK_MANAGER", signature: null };

describe("ProfileSettings — signature editor", () => {
  const updateSignature = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    updateSignature.mockResolvedValue(undefined);
    fetchEmailRulesMock.mockResolvedValue([]);
    fetchLabelsMock.mockResolvedValue([]);
  });

  it("shows a message instead of the form when there is no signed-in user", () => {
    useAuthMock.mockReturnValue({ user: null, updateSignature });
    renderProfile();
    expect(screen.getByText(/יש להתחבר/)).toBeInTheDocument();
  });

  it("loads the current signature into the editor", () => {
    useAuthMock.mockReturnValue({
      user: { ...DEMO_USER, signature: "יוסי כהן, מנהל סיכונים" },
      updateSignature,
    });
    renderProfile();
    expect(screen.getByTestId("signature-textfield")).toHaveValue("יוסי כהן, מנהל סיכונים");
  });

  it("the save button starts disabled (no change yet) and enables once the signature is edited", async () => {
    useAuthMock.mockReturnValue({ user: DEMO_USER, updateSignature });
    renderProfile();

    const saveButton = screen.getByTestId("save-signature-button");
    expect(saveButton).toBeDisabled();

    await userEvent.type(screen.getByTestId("signature-textfield"), "חתימה חדשה");
    expect(saveButton).not.toBeDisabled();
  });

  it("saves the edited signature via updateSignature and shows a success confirmation", async () => {
    useAuthMock.mockReturnValue({ user: DEMO_USER, updateSignature });
    renderProfile();

    await userEvent.type(screen.getByTestId("signature-textfield"), "חתימה חדשה");
    await userEvent.click(screen.getByTestId("save-signature-button"));

    expect(updateSignature).toHaveBeenCalledWith("חתימה חדשה");
    expect(await screen.findByText("החתימה נשמרה בהצלחה.")).toBeInTheDocument();
  });

  it("clearing the signature saves null rather than an empty string", async () => {
    useAuthMock.mockReturnValue({ user: { ...DEMO_USER, signature: "ישן" }, updateSignature });
    renderProfile();

    const field = screen.getByTestId("signature-textfield");
    await userEvent.clear(field);
    await userEvent.click(screen.getByTestId("save-signature-button"));

    expect(updateSignature).toHaveBeenCalledWith(null);
  });

  it("shows an error message and keeps the edited text if saving fails", async () => {
    updateSignature.mockRejectedValue(new Error("network error"));
    useAuthMock.mockReturnValue({ user: DEMO_USER, updateSignature });
    renderProfile();

    await userEvent.type(screen.getByTestId("signature-textfield"), "חתימה חדשה");
    await userEvent.click(screen.getByTestId("save-signature-button"));

    expect(await screen.findByText(/שמירת החתימה נכשלה/)).toBeInTheDocument();
    expect(screen.getByTestId("signature-textfield")).toHaveValue("חתימה חדשה");
  });
});

describe("ProfileSettings — email rules builder (TODO_SPEC.md \"משימה 17\")", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ user: DEMO_USER, updateSignature: vi.fn() });
    fetchEmailRulesMock.mockResolvedValue([]);
    fetchLabelsMock.mockResolvedValue([]);
  });

  it("starts with one empty condition row and one empty action row, and a disabled save button", async () => {
    renderProfile();

    expect(await screen.findByTestId("rule-condition-value-0")).toHaveValue("");
    expect(screen.getByTestId("rule-condition-field-0")).toHaveValue("subject");
    expect(screen.getByTestId("rule-condition-operator-0")).toHaveValue("contains");
    expect(screen.getByTestId("rule-action-type-0")).toHaveValue("mark_as_read");
    expect(screen.getByTestId("save-rule-button")).toBeDisabled();

    // A single row can't be removed — deleting the last condition/action would
    // leave the rule unable to fire.
    expect(screen.getByTestId("remove-condition-0")).toBeDisabled();
    expect(screen.getByTestId("remove-action-0")).toBeDisabled();
  });

  it("adding and removing condition rows works, and remove re-disables at one row", async () => {
    renderProfile();
    await screen.findByTestId("rule-condition-value-0");

    await userEvent.click(screen.getByTestId("add-condition-button"));
    expect(screen.getByTestId("rule-condition-value-1")).toBeInTheDocument();
    expect(screen.getByTestId("remove-condition-0")).not.toBeDisabled();

    await userEvent.click(screen.getByTestId("remove-condition-1"));
    expect(screen.queryByTestId("rule-condition-value-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("remove-condition-0")).toBeDisabled();
  });

  it("creates a rule with the entered name/condition/action (mark_as_read needs no value) and resets the form", async () => {
    createEmailRuleMock.mockResolvedValue({
      id: 1, user_id: 1, name: "תיוג דחוף",
      conditions: [{ field: "subject", operator: "contains", value: "דחוף" }],
      actions: [{ type: "mark_as_read", value: null }],
      is_active: true, created_at: "2026-01-01T00:00:00",
    });
    renderProfile();
    await screen.findByTestId("rule-condition-value-0");

    await userEvent.type(screen.getByTestId("rule-name-input"), "תיוג דחוף");
    await userEvent.type(screen.getByTestId("rule-condition-value-0"), "דחוף");

    const saveButton = screen.getByTestId("save-rule-button");
    expect(saveButton).not.toBeDisabled();
    await userEvent.click(saveButton);

    await waitFor(() =>
      expect(createEmailRuleMock).toHaveBeenCalledWith({
        name: "תיוג דחוף",
        conditions: [{ field: "subject", operator: "contains", value: "דחוף" }],
        actions: [{ type: "mark_as_read", value: null }],
      }),
    );
    await waitFor(() => expect(screen.getByTestId("rule-name-input")).toHaveValue(""));
  });

  it("save stays disabled until every condition/action value is filled in", async () => {
    renderProfile();
    await screen.findByTestId("rule-condition-value-0");

    await userEvent.type(screen.getByTestId("rule-name-input"), "כלל");
    // Condition value still empty -> still disabled.
    expect(screen.getByTestId("save-rule-button")).toBeDisabled();

    await userEvent.type(screen.getByTestId("rule-condition-value-0"), "x");
    expect(screen.getByTestId("save-rule-button")).not.toBeDisabled();
  });

  it("choosing the add_label action reveals a label picker sourced from the user's own labels", async () => {
    fetchLabelsMock.mockResolvedValue([{ id: 7, name: "דחוף", color: "#e53935" }]);
    renderProfile();
    await screen.findByTestId("rule-condition-value-0");

    await userEvent.click(screen.getByRole("combobox", { name: "סוג פעולה" }));
    await userEvent.click(await screen.findByRole("option", { name: "הוסף תגית" }));

    const labelPicker = await screen.findByRole("combobox", { name: "תגית" });
    // add_label needs a value picked -> save is still disabled until then.
    await userEvent.type(screen.getByTestId("rule-name-input"), "כלל תגית");
    await userEvent.type(screen.getByTestId("rule-condition-value-0"), "x");
    expect(screen.getByTestId("save-rule-button")).toBeDisabled();

    await userEvent.click(labelPicker);
    await userEvent.click(await screen.findByRole("option", { name: "דחוף" }));
    expect(screen.getByTestId("save-rule-button")).not.toBeDisabled();

    await userEvent.click(screen.getByTestId("save-rule-button"));
    await waitFor(() =>
      expect(createEmailRuleMock).toHaveBeenCalledWith(
        expect.objectContaining({ actions: [{ type: "add_label", value: "7" }] }),
      ),
    );
  });

  it("choosing move_to_folder reveals a folder picker, including the direct-to-trash option", async () => {
    renderProfile();
    await screen.findByTestId("rule-condition-value-0");

    await userEvent.click(screen.getByRole("combobox", { name: "סוג פעולה" }));
    await userEvent.click(await screen.findByRole("option", { name: "העבר לתיקייה" }));

    const folderPicker = await screen.findByRole("combobox", { name: "תיקיית יעד" });
    await userEvent.click(folderPicker);
    await userEvent.click(await screen.findByRole("option", { name: /אשפה/ }));

    await userEvent.type(screen.getByTestId("rule-name-input"), "כלל אשפה");
    await userEvent.type(screen.getByTestId("rule-condition-value-0"), "פרסומת");
    await userEvent.click(screen.getByTestId("save-rule-button"));

    await waitFor(() =>
      expect(createEmailRuleMock).toHaveBeenCalledWith(
        expect.objectContaining({ actions: [{ type: "move_to_folder", value: "TRASH" }] }),
      ),
    );
  });

  it("lists existing rules with a readable if/then summary and an active/inactive chip", async () => {
    fetchEmailRulesMock.mockResolvedValue([
      {
        id: 3, user_id: 1, name: "תיוג דחוף",
        conditions: [{ field: "subject", operator: "contains", value: "דחוף" }],
        actions: [{ type: "add_label", value: "7" }],
        is_active: true, created_at: "2026-01-01T00:00:00",
      },
      {
        id: 4, user_id: 1, name: "כלל כבוי",
        conditions: [{ field: "sender", operator: "equals", value: "spam@example.com" }],
        actions: [{ type: "mark_as_read", value: null }],
        is_active: false, created_at: "2026-01-01T00:00:00",
      },
    ]);
    fetchLabelsMock.mockResolvedValue([{ id: 7, name: "דחוף", color: "#e53935" }]);
    renderProfile();

    const active = await screen.findByTestId("rule-item-3");
    expect(active).toHaveTextContent("תיוג דחוף");
    expect(active).toHaveTextContent("פעיל");
    expect(active).toHaveTextContent('נושא מכיל "דחוף"');
    expect(active).toHaveTextContent('הוסף תגית "דחוף"');

    const inactive = screen.getByTestId("rule-item-4");
    expect(inactive).toHaveTextContent("לא פעיל");
    expect(inactive).toHaveTextContent('שולח (כתובת אימייל) שווה בדיוק ל "spam@example.com"');
  });

  it("deletes a rule via its delete button", async () => {
    fetchEmailRulesMock.mockResolvedValue([
      {
        id: 3, user_id: 1, name: "כלל למחיקה",
        conditions: [{ field: "subject", operator: "contains", value: "x" }],
        actions: [{ type: "mark_as_read", value: null }],
        is_active: true, created_at: "2026-01-01T00:00:00",
      },
    ]);
    deleteEmailRuleMock.mockResolvedValue(undefined);
    renderProfile();

    await screen.findByTestId("rule-item-3");
    await userEvent.click(screen.getByTestId("delete-rule-3"));

    await waitFor(() => expect(deleteEmailRuleMock).toHaveBeenCalledWith(3));
  });
});
