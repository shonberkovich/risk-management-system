import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sendAgentChatMessageMock, streamAgentChatMessageMock, proposeMitigationTaskMock, useAuthMock, StreamError } =
  vi.hoisted(() => ({
    sendAgentChatMessageMock: vi.fn(),
    streamAgentChatMessageMock: vi.fn(),
    proposeMitigationTaskMock: vi.fn(),
    useAuthMock: vi.fn(),
    StreamError: class extends Error {
      status: number;
      constructor(message: string, status: number) {
        super(message);
        this.status = status;
      }
    },
  }));
vi.mock("../../auth/AuthContext", () => ({ useAuth: useAuthMock }));
vi.mock("../../api/client", () => ({
  AgentChatStreamError: StreamError,
  sendAgentChatMessage: sendAgentChatMessageMock,
  streamAgentChatMessage: streamAgentChatMessageMock,
  proposeMitigationTask: proposeMitigationTaskMock,
  confirmAgentAction: vi.fn(),
  rejectAgentAction: vi.fn(),
  createMitigationTask: vi.fn(),
}));

import AIAssistant from "./AIAssistant";
import { AIAssistantProvider } from "./AIAssistantContext";

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

const LOSS_RATIO_CHART = {
  chart_type: "bar",
  title: "יחס הפסד לפי אזור",
  x_label: "אזור",
  y_label: "",
  unit: "%",
  series: ["יחס הפסד"],
  points: [
    { label: "מרכז", values: [42.5] },
    { label: "צפון", values: [18] },
  ],
};

describe("AIAssistant", () => {
  beforeAll(() => {
    // Recharts' ResponsiveContainer observes its size; jsdom has no ResizeObserver.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "דנה", role: "RISK_MANAGER" } });
  });

  it("suggests only external-data questions to a FIELD_WORKER", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 5, full_name: "רונית", role: "FIELD_WORKER" } });
    renderAssistant();
    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByText("האם יש התרעות מזג אוויר פעילות?")).toBeInTheDocument();
    expect(screen.queryByText("מהו ה-TIV הכולל של תיק הנכסים?")).not.toBeInTheDocument();
    expect(screen.queryByText("אילו נכסים חורגים מתאימות לתקן ISO 31000?")).not.toBeInTheDocument();
  });

  it("sends a suggested question and renders the routed agent's answer with its badge", async () => {
    streamAgentChatMessageMock.mockResolvedValue({
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
    expect(streamAgentChatMessageMock).toHaveBeenCalledWith("מהו ה-TIV הכולל של תיק הנכסים?", null, expect.any(Function));
  });

  it("reuses the session_id from the first reply on the next message", async () => {
    streamAgentChatMessageMock.mockResolvedValue({
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

    expect(streamAgentChatMessageMock).toHaveBeenLastCalledWith("שאלה נוספת", "s1", expect.any(Function));
  });

  it("maps a 503 to the 'AI not configured' message", async () => {
    streamAgentChatMessageMock.mockRejectedValue(new StreamError("AI not configured", 503));
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
    expect(streamAgentChatMessageMock).not.toHaveBeenCalled();
  });

  it("shows the answer while it is still streaming in", async () => {
    let finish: (value: unknown) => void = () => {};
    streamAgentChatMessageMock.mockImplementation((_message, _session, onText: (text: string) => void) => {
      onText("יש 9 תביעות");
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    renderAssistant();
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByText("מהו ה-TIV הכולל של תיק הנכסים?"));

    expect(await screen.findByText("יש 9 תביעות")).toBeInTheDocument();
    expect(screen.queryByText("סוכן נתונים פנימיים")).not.toBeInTheDocument(); // label only once done

    finish({ session_id: "s1", agent: "DATA_AGENT", reasoning: "x", answer: "יש 9 תביעות פתוחות." });
    expect(await screen.findByText("יש 9 תביעות פתוחות.")).toBeInTheDocument();
    expect(screen.getByText("סוכן נתונים פנימיים")).toBeInTheDocument();
  });

  it("falls back to the non-streaming endpoint on a 401 (expired token)", async () => {
    streamAgentChatMessageMock.mockRejectedValue(new StreamError("expired", 401));
    sendAgentChatMessageMock.mockResolvedValue({
      session_id: "s1",
      agent: "EXTERNAL_DATA_AGENT",
      reasoning: "x",
      answer: "אין התרעות",
    });
    renderAssistant();
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByText("מהו ה-TIV הכולל של תיק הנכסים?"));

    expect(await screen.findByText("אין התרעות")).toBeInTheDocument();
    expect(sendAgentChatMessageMock).toHaveBeenCalledWith("מהו ה-TIV הכולל של תיק הנכסים?", null);
  });

  it("renders a chart streamed in with the answer", async () => {
    let finish: (value: unknown) => void = () => {};
    streamAgentChatMessageMock.mockImplementation(
      (_message, _session, onUpdate: (text: string, charts: unknown[]) => void) => {
        onUpdate("הנה הגרף", []);
        onUpdate("הנה הגרף", [LOSS_RATIO_CHART]);
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
    );
    renderAssistant();
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByText("מהו ה-TIV הכולל של תיק הנכסים?"));

    const figure = await screen.findByRole("figure", { name: "יחס הפסד לפי אזור" });
    expect(within(figure).getByRole("rowheader", { name: "מרכז" })).toBeInTheDocument();
    expect(within(figure).getByRole("cell", { name: "42.5%" })).toBeInTheDocument();
    expect(within(figure).getByRole("cell", { name: "18%" })).toBeInTheDocument();

    finish({ session_id: "s1", agent: "DATA_AGENT", reasoning: "x", answer: "הנה הגרף.", charts: [LOSS_RATIO_CHART] });
    expect(await screen.findByText("הנה הגרף.")).toBeInTheDocument();
    expect(screen.getAllByRole("figure")).toHaveLength(1); // the final answer keeps the same chart, not a second one
  });

  it("renders charts from the non-streaming fallback too", async () => {
    streamAgentChatMessageMock.mockRejectedValue(new StreamError("expired", 401));
    sendAgentChatMessageMock.mockResolvedValue({
      session_id: "s1",
      agent: "DATA_AGENT",
      reasoning: "x",
      answer: "הנה הגרף.",
      charts: [{ ...LOSS_RATIO_CHART, chart_type: "pie" }],
    });
    renderAssistant();
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByText("מהו ה-TIV הכולל של תיק הנכסים?"));

    expect(await screen.findByRole("figure", { name: "יחס הפסד לפי אזור" })).toBeInTheDocument();
  });
});
