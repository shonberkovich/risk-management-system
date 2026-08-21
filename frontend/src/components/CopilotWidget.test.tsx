import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { askQuestionMock } = vi.hoisted(() => ({ askQuestionMock: vi.fn() }));
vi.mock("../api/client", () => ({ askQuestion: askQuestionMock }));

import CopilotWidget from "./CopilotWidget";

function axiosErrorWithStatus(status: number, detail?: string) {
  return new AxiosError(
    "Request failed",
    String(status),
    { headers: new AxiosHeaders() },
    {},
    {
      status,
      statusText: "",
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: detail ? { detail } : {},
    },
  );
}

describe("CopilotWidget error mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the fetched answer on success", async () => {
    askQuestionMock.mockResolvedValue({ answer: "ה-TIV הכולל הוא 10,000,000 ₪" });
    render(<CopilotWidget />);
    await userEvent.click(screen.getByRole("button"));
    // Use a suggested question chip to avoid brittle icon-button targeting.
    await userEvent.click(screen.getByText("מהו ה-TIV הכולל של תיק הנכסים?"));
    expect(await screen.findByText("ה-TIV הכולל הוא 10,000,000 ₪")).toBeInTheDocument();
  });

  it("maps a 503 to the 'AI not configured' message", async () => {
    askQuestionMock.mockRejectedValue(axiosErrorWithStatus(503));
    render(<CopilotWidget />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByText("מהו ה-TIV הכולל של תיק הנכסים?"));
    expect(await screen.findByText("שירות ה-AI אינו מוגדר כרגע (חסר מפתח API בצד השרת).")).toBeInTheDocument();
  });

  it("maps a 429 to the rate-limit message", async () => {
    askQuestionMock.mockRejectedValue(axiosErrorWithStatus(429));
    render(<CopilotWidget />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByText("מהו ה-TIV הכולל של תיק הנכסים?"));
    expect(await screen.findByText("יותר מדי בקשות בזמן קצר — נסו שוב בעוד רגע.")).toBeInTheDocument();
  });

  it("surfaces a server-provided detail message for other axios error statuses", async () => {
    askQuestionMock.mockRejectedValue(axiosErrorWithStatus(400, "שאלה לא תקינה"));
    render(<CopilotWidget />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByText("מהו ה-TIV הכולל של תיק הנכסים?"));
    expect(await screen.findByText("שאלה לא תקינה")).toBeInTheDocument();
  });

  it("falls back to a generic message for a non-axios/unknown error", async () => {
    askQuestionMock.mockRejectedValue(new Error("boom"));
    render(<CopilotWidget />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByText("מהו ה-TIV הכולל של תיק הנכסים?"));
    expect(await screen.findByText("שגיאה בפנייה לשירות ה-AI. נסו שוב מאוחר יותר.")).toBeInTheDocument();
  });

  it("ignores empty/whitespace-only submissions without calling the API", async () => {
    render(<CopilotWidget />);
    await userEvent.click(screen.getByRole("button"));
    const input = await screen.findByPlaceholderText("שאלו שאלה...");
    await userEvent.type(input, "   ");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(askQuestionMock).not.toHaveBeenCalled());
  });

  it("clears the conversation when the clear button is used", async () => {
    askQuestionMock.mockResolvedValue({ answer: "תשובה" });
    render(<CopilotWidget />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByText("מהו ה-TIV הכולל של תיק הנכסים?"));
    await screen.findByText("תשובה");

    await userEvent.click(screen.getByRole("button", { name: "נקה שיחה" }));
    expect(screen.queryByText("תשובה")).not.toBeInTheDocument();
    expect(screen.getByText("מהו ה-TIV הכולל של תיק הנכסים?")).toBeInTheDocument();
  });
});
