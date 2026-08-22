/**
 * Tests for ProfileSettings.tsx (TODO_SPEC.md "משימה 14" step 2) — the first
 * self-service "Profile Settings" screen in this app: loads the signed-in user's
 * current signature, lets it be edited, and saves it via AuthContext's
 * `updateSignature` (which itself calls `PATCH /api/users/{id}/signature`, tested
 * separately at the API-client/router level).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));

import ProfileSettings from "./ProfileSettings";

describe("ProfileSettings", () => {
  const updateSignature = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    updateSignature.mockResolvedValue(undefined);
  });

  it("shows a message instead of the form when there is no signed-in user", () => {
    useAuthMock.mockReturnValue({ user: null, updateSignature });
    render(<ProfileSettings />);
    expect(screen.getByText(/יש להתחבר/)).toBeInTheDocument();
  });

  it("loads the current signature into the editor", () => {
    useAuthMock.mockReturnValue({
      user: { user_id: 1, full_name: "יוסי כהן", role: "RISK_MANAGER", signature: "יוסי כהן, מנהל סיכונים" },
      updateSignature,
    });
    render(<ProfileSettings />);
    expect(screen.getByTestId("signature-textfield")).toHaveValue("יוסי כהן, מנהל סיכונים");
  });

  it("the save button starts disabled (no change yet) and enables once the signature is edited", async () => {
    useAuthMock.mockReturnValue({
      user: { user_id: 1, full_name: "יוסי כהן", role: "RISK_MANAGER", signature: null },
      updateSignature,
    });
    render(<ProfileSettings />);

    const saveButton = screen.getByTestId("save-signature-button");
    expect(saveButton).toBeDisabled();

    await userEvent.type(screen.getByTestId("signature-textfield"), "חתימה חדשה");
    expect(saveButton).not.toBeDisabled();
  });

  it("saves the edited signature via updateSignature and shows a success confirmation", async () => {
    useAuthMock.mockReturnValue({
      user: { user_id: 1, full_name: "יוסי כהן", role: "RISK_MANAGER", signature: null },
      updateSignature,
    });
    render(<ProfileSettings />);

    await userEvent.type(screen.getByTestId("signature-textfield"), "חתימה חדשה");
    await userEvent.click(screen.getByTestId("save-signature-button"));

    expect(updateSignature).toHaveBeenCalledWith("חתימה חדשה");
    expect(await screen.findByText("החתימה נשמרה בהצלחה.")).toBeInTheDocument();
  });

  it("clearing the signature saves null rather than an empty string", async () => {
    useAuthMock.mockReturnValue({
      user: { user_id: 1, full_name: "יוסי כהן", role: "RISK_MANAGER", signature: "ישן" },
      updateSignature,
    });
    render(<ProfileSettings />);

    const field = screen.getByTestId("signature-textfield");
    await userEvent.clear(field);
    await userEvent.click(screen.getByTestId("save-signature-button"));

    expect(updateSignature).toHaveBeenCalledWith(null);
  });

  it("shows an error message and keeps the edited text if saving fails", async () => {
    updateSignature.mockRejectedValue(new Error("network error"));
    useAuthMock.mockReturnValue({
      user: { user_id: 1, full_name: "יוסי כהן", role: "RISK_MANAGER", signature: null },
      updateSignature,
    });
    render(<ProfileSettings />);

    await userEvent.type(screen.getByTestId("signature-textfield"), "חתימה חדשה");
    await userEvent.click(screen.getByTestId("save-signature-button"));

    expect(await screen.findByText(/שמירת החתימה נכשלה/)).toBeInTheDocument();
    expect(screen.getByTestId("signature-textfield")).toHaveValue("חתימה חדשה");
  });
});
