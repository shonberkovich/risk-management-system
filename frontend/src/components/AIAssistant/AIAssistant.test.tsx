import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendAgentChatMessageMock, proposeMitigationTaskMock } = vi.hoisted(() => ({
  sendAgentChatMessageMock: vi.fn(),
  proposeMitigationTaskMock: vi.fn(),
}));
vi.mock("../../api/client", () => ({
  sendAgentChatMessage: sendAgentChatMessageMock,
  proposeMitigationTask: proposeMitigationTaskMock,
  confirmAgentAction: vi.fn(),
  rejectAgentAction: vi.fn(),
  createMitigationTask: vi.fn(),
}));

import AIAssistant from "./AIAssistant";
import { AIAssistantProvider } from "./AIAssistantContext";

function axiosErrorWithStatus(status: number) {
  return new AxiosError(
    "Request failed",
    String(status),
    { headers: new AxiosHeaders() },
    {},
    { status, statusText: "", headers: {}, config: { headers: new AxiosHeaders() }, data: {} }
  );
}

function renderAssistant() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AIAssistantProvider>
        <AIAssistant />
      </AIAssistantProvider>
    </QueryClientProvider>
  );
}

describe("AIAssistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a suggested question and renders the routed agent's answer with its badge", async () => {
    sendAgentChatMessageMock.mockResolvedValue({
      session_id: "s1",
      agent: "DATA_AGENT",
      reasoning: "שאלת נתונים",
      answer: "ה-TIV הכולל הוא 10,000,000 ₪",
    });
    renderAssistant();
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByText("מהו ה-TIV הכולל של תיק הנכסים?"));

    expect(await screen.findByText("ה-TIV הכולל הוא 10,000,000 ₪")).toBeInTheDocument();
    expect(screen.getByText("סוכן נתונים פנימיים")).toBeInTheDocument();
    expect(sendAgentChatMessageMock).toHaveBeenCalledWith("מהו ה-TIV הכולל של תיק הנכסים?", null);
  });

  it("reuses the session_id from the first reply on the next message", async () => {
    sendAgentChatMessageMock.mockResolvedValue({
      session_id: "s1",
      agent: "DATA_AGENT",
      reasoning: "x",
      answer: "תשובה ראשונה",
    });
    renderAssistant();
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByText("מהו ה-TIV הכולל של תיק הנכסים?"));
    await screen.findByText("תשובה ראשונה");

    const input = screen.getByPlaceholderText("שאלו את מערך הסוכנים...");
    await userEvent.type(input, "שאלה נוספת{Enter}");

    expect(sendAgentChatMessageMock).toHaveBeenLastCalledWith("שאלה נוספת", "s1");
  });

  it("maps a 503 to the 'AI not configured' message", async () => {
    sendAgentChatMessageMock.mockRejectedValue(axiosErrorWithStatus(503));
    renderAssistant();
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByText("מהו ה-TIV הכולל של תיק הנכסים?"));
    expect(
      await screen.findByText("שירות ה-AI אינו מוגדר כרגע (חסר מפתח API בצד השרת).")
    ).toBeInTheDocument();
  });

  it("ignores empty/whitespace-only submissions without calling the API", async () => {
    renderAssistant();
    await userEvent.click(screen.getByRole("button"));
    const input = await screen.findByPlaceholderText("שאלו את מערך הסוכנים...");
    await userEvent.type(input, "   {Enter}");
    expect(sendAgentChatMessageMock).not.toHaveBeenCalled();
  });
});
