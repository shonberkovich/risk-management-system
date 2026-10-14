/**
 * "הסבר לי את הנכס" on PropertyDetail: one click streams a short AI analysis into a
 * glass card (shimmer until the first words, then typed out), with regenerate and
 * Hebrew error messages for 503/429/403. The stream itself
 * (POST /api/ai/properties/{id}/explain) is mocked at api/client.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPropertyMock, streamPropertyExplanationMock, useAuthMock, AiStreamError } = vi.hoisted(() => {
  class AiStreamError extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  }
  return {
    fetchPropertyMock: vi.fn(),
    streamPropertyExplanationMock: vi.fn(),
    useAuthMock: vi.fn(),
    AiStreamError,
  };
});

vi.mock("../api/client", () => ({
  AiStreamError,
  deactivateProperty: vi.fn(),
  deleteDocument: vi.fn(),
  fetchDocumentSignedUrl: vi.fn(),
  fetchDocumentsForEntity: vi.fn().mockResolvedValue([]),
  fetchEntityEmails: vi.fn().mockResolvedValue([]),
  fetchProperty: fetchPropertyMock,
  fetchPropertyHazmatProximity: vi.fn().mockResolvedValue([]),
  fetchReplacementValueUpdates: vi.fn().mockResolvedValue([]),
  streamPropertyExplanation: streamPropertyExplanationMock,
  uploadDocument: vi.fn(),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));
vi.mock("../components/PropertyDialog", () => ({ default: () => null }));
vi.mock("../components/RiskSurveyDialog", () => ({ default: () => null }));

import { AIAssistantProvider } from "../components/AIAssistant/AIAssistantContext";
import PropertyDetail from "./PropertyDetail";

const PROPERTY = {
  property_id: 7,
  property_code: "PRP-007",
  name: "מרכז לוגיסטי חיפה",
  address: "דרך העצמאות 1",
  region: "צפון",
  latitude: 32.8,
  longitude: 35.0,
  asset_type: "LOGISTICS_CENTER",
  replacement_value: 40_000_000,
  book_value: 30_000_000,
  is_active: true,
  risk_profile: null,
  manager_name: null,
  active_policy: null,
};

const ANSWER = "ציון הסיכון של הנכס גבוה בעיקר בגלל סיכון השריפה. המשימה המשתלמת ביותר היא התקנת מתזים.";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/properties/7"]}>
        <AIAssistantProvider>{children}</AIAssistantProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <Routes>
      <Route path="/properties/:id" element={<PropertyDetail />} />
    </Routes>,
    { wrapper },
  );
}

/** A stream the test drives by hand: `push` emits text, `finish` resolves it. */
function controllableStream() {
  let onText: (text: string) => void = () => {};
  let finish: (text: string) => void = () => {};
  streamPropertyExplanationMock.mockImplementation((_id: number, cb: (text: string) => void) => {
    onText = cb;
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  });
  return {
    push: (text: string) => onText(text),
    finish: (text: string) => finish(text),
  };
}

/** The card types text out a few characters per 16ms tick; under a loaded full-suite run
 * that can take well over waitFor's 1s default. */
function typedOut(text: string) {
  return waitFor(() => expect(screen.getByTestId("explain-text")).toHaveTextContent(text), { timeout: 5000 });
}

async function clickExplain() {
  await screen.findByText("מרכז לוגיסטי חיפה");
  await userEvent.click(screen.getByRole("button", { name: /הסבר לי את הנכס/ }));
}

describe("PropertyDetail — 'הסבר לי את הנכס'", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPropertyMock.mockResolvedValue(PROPERTY);
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "מנהל סיכונים", role: "RISK_MANAGER" } });
  });

  it("shows a shimmer until the first words, then types out the streamed analysis", async () => {
    const stream = controllableStream();
    renderPage();
    expect(screen.queryByRole("region", { name: "ניתוח AI של הנכס" })).not.toBeInTheDocument();

    await clickExplain();

    expect(streamPropertyExplanationMock).toHaveBeenCalledWith(7, expect.any(Function), expect.any(AbortSignal));
    expect(screen.getByTestId("explain-loading")).toBeInTheDocument();
    // The button can't fire a second request while one is running.
    expect(screen.getByRole("button", { name: /הסבר לי את הנכס/ })).toBeDisabled();

    stream.push("ציון הסיכון של הנכס גבוה");
    await typedOut("ציון הסיכון של הנכס גבוה");
    expect(screen.queryByTestId("explain-loading")).not.toBeInTheDocument();

    stream.push(ANSWER);
    stream.finish(ANSWER);
    await typedOut(ANSWER);
    expect(screen.getByRole("button", { name: /הסבר לי את הנכס/ })).toBeEnabled();
    // RISK_MANAGER sees financial figures, so no "omitted" note.
    expect(screen.queryByText(/נתונים כספיים/)).not.toBeInTheDocument();
  });

  it("regenerates on the refresh button", async () => {
    streamPropertyExplanationMock.mockImplementation(async (_id: number, cb: (text: string) => void) => {
      cb(ANSWER);
      return ANSWER;
    });
    renderPage();
    await clickExplain();
    await typedOut(ANSWER);

    await userEvent.click(screen.getByRole("button", { name: "ניתוח מחדש" }));

    await waitFor(() => expect(streamPropertyExplanationMock).toHaveBeenCalledTimes(2));
    await typedOut(ANSWER);
  });

  it("closes the card", async () => {
    streamPropertyExplanationMock.mockResolvedValue(ANSWER);
    renderPage();
    await clickExplain();

    await userEvent.click(await screen.findByRole("button", { name: "סגירת הניתוח" }));

    expect(screen.queryByRole("region", { name: "ניתוח AI של הנכס" })).not.toBeInTheDocument();
  });

  it.each([
    [503, "", /לא הוגדר מפתח API/],
    [429, "חריגה ממכסת הבקשות ל-AI (10 בקשות ל-60 שניות). נסה שוב בעוד 42 שניות.", /נסה שוב בעוד 42 שניות/],
    [403, "", /אין לתפקידך הרשאה/],
    [0, "AI service unreachable", /נכשל באמצע הניתוח/],
  ])("shows a Hebrew error for status %i", async (status, detail, expected) => {
    streamPropertyExplanationMock.mockRejectedValue(new AiStreamError(detail, status));
    renderPage();
    await clickExplain();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(expected);

    // "נסו שוב" retries the request.
    streamPropertyExplanationMock.mockResolvedValue(ANSWER);
    await userEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
    await waitFor(() => expect(streamPropertyExplanationMock).toHaveBeenCalledTimes(2));
  });

  it("tells a FIELD_WORKER that financial figures are left out", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 3, full_name: "עובד שטח", role: "FIELD_WORKER" } });
    streamPropertyExplanationMock.mockImplementation(async (_id: number, cb: (text: string) => void) => {
      cb(ANSWER);
      return ANSWER;
    });
    renderPage();
    await clickExplain();

    await typedOut(ANSWER);
    expect(screen.getByText(/נתונים כספיים .* אינם כלולים בניתוח/)).toBeInTheDocument();
  });
});
