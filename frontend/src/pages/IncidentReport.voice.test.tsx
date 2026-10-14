/**
 * Hebrew voice dictation on the report wizard's description step: spoken words fill
 * the description live (after any typed text), a finished dictation runs the AI
 * classification exactly like the "נתח עם AI" button, and a browser without the Web
 * Speech API — or with the microphone blocked — never breaks the typed flow.
 *
 * The recognizer is a scripted stand-in for window.webkitSpeechRecognition: tests
 * push interim/final results and end the session the way Chrome does.
 */
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPropertiesMock, classifyIncidentMock } = vi.hoisted(() => ({
  fetchPropertiesMock: vi.fn(),
  classifyIncidentMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  classifyIncident: classifyIncidentMock,
  createIncident: vi.fn(),
  fetchIncident: vi.fn(),
  fetchProperties: fetchPropertiesMock,
  reverseGeocode: vi.fn(),
  submitDraftIncident: vi.fn(),
  updateDraftIncident: vi.fn(),
  uploadIncidentMedia: vi.fn(),
}));

import IncidentReport from "./IncidentReport";

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  interimResults = false;
  continuous = true;
  maxAlternatives = 0;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  // Like Chrome: stop() still delivers what was heard, then ends the session.
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn(() => {
    this.onerror?.({ error: "aborted" });
    this.onend?.();
  });

  constructor() {
    FakeRecognition.instances.push(this);
  }

  /** Pushes the session's full result list, e.g. [["יש נזילה", true], ["גדולה", false]]. */
  hear(results: [transcript: string, isFinal: boolean][]) {
    const list = results.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }));
    act(() => this.onresult?.({ resultIndex: 0, results: list }));
  }

  /** The browser ends the session on its own (end of speech / silence). */
  endOfSpeech() {
    act(() => this.onend?.());
  }

  fail(error: string) {
    act(() => {
      this.onerror?.({ error });
      this.onend?.();
    });
  }
}

const latest = () => FakeRecognition.instances[FakeRecognition.instances.length - 1];

const PROPERTY = { property_id: 1, property_code: "PRP-007", name: "סניף חיפה", latitude: 32.79, longitude: 34.99 };
const CLASSIFICATION = {
  hazard_type: "FLOOD",
  severity_level: "HIGH",
  operational_impact: "PARTIAL_SHUTDOWN",
  estimated_loss_ils: 85000,
  business_interruption_likely: true,
  reasoning: "נזילת מים גדולה בחניון — סיכון להצפה.",
  confidence: 0.9,
};

function renderWizard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<IncidentReport />, { wrapper });
}

/** Drives the wizard to the description step (step 3 of 4). */
async function goToDescriptionStep() {
  renderWizard();
  await userEvent.click(await screen.findByLabelText(/^נכס/));
  await userEvent.click(await screen.findByText("סניף חיפה (PRP-007)"));
  await userEvent.click(screen.getByRole("button", { name: "המשך" }));
  await userEvent.click(screen.getByRole("button", { name: "אחר" }));
  await userEvent.click(screen.getByRole("button", { name: "נמוכה" }));
  await userEvent.click(screen.getByRole("button", { name: "פעיל כרגיל" }));
  await userEvent.click(screen.getByRole("button", { name: "המשך" }));
  return screen.getByLabelText("תיאור האירוע") as HTMLTextAreaElement;
}

const micButton = () => screen.getByRole("button", { name: "התחלת דיווח קולי" });

describe("IncidentReport — Hebrew voice dictation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    FakeRecognition.instances = [];
    fetchPropertiesMock.mockResolvedValue([PROPERTY]);
    classifyIncidentMock.mockResolvedValue(CLASSIFICATION);
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    onlineManager.setOnline(true);
  });

  it("streams the spoken words into the description, after what was already typed", async () => {
    const field = await goToDescriptionStep();
    await userEvent.type(field, "דיווח מהשטח:");

    await userEvent.click(micButton());
    const rec = latest();
    expect(rec.lang).toBe("he-IL");
    expect(rec.interimResults).toBe(true);
    expect(rec.start).toHaveBeenCalledTimes(1);
    expect(screen.getByText("מקשיב… דברו עכשיו")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "עצירת הדיווח הקולי" })).toBeInTheDocument();
    // Classifying half a sentence makes no sense: the AI button waits for the end.
    expect(screen.getByRole("button", { name: "נתח עם AI" })).toBeDisabled();

    rec.hear([["יש נזילה", false]]);
    expect(field.value).toBe("דיווח מהשטח: יש נזילה");

    // The interim guess is replaced, not duplicated, as the recognizer settles.
    rec.hear([["יש נזילה גדולה בחניון", true], [" של סניף", false]]);
    expect(field.value).toBe("דיווח מהשטח: יש נזילה גדולה בחניון של סניף");
    expect(classifyIncidentMock).not.toHaveBeenCalled();
  });

  it("tapping the mic again stops listening and classifies the full description", async () => {
    const field = await goToDescriptionStep();
    await userEvent.click(micButton());
    const rec = latest();
    rec.hear([["יש נזילה גדולה בחניון של סניף חיפה", true]]);

    await userEvent.click(screen.getByRole("button", { name: "עצירת הדיווח הקולי" }));

    expect(rec.stop).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(classifyIncidentMock).toHaveBeenCalledTimes(1));
    expect(classifyIncidentMock.mock.calls[0][0]).toBe("יש נזילה גדולה בחניון של סניף חיפה");
    expect(field.value).toBe("יש נזילה גדולה בחניון של סניף חיפה");

    // Same result handling as the "נתח עם AI" button: the AI summary and the filled fields.
    expect(await screen.findByText("ניתוח AI (ביטחון: 90%)")).toBeInTheDocument();
    expect(screen.getByText("הצפה")).toBeInTheDocument();
    expect(screen.getByText("גבוהה")).toBeInTheDocument();
    expect(screen.getByLabelText("הערכת נזק ראשונית (₪)")).toHaveValue(85000);
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("button", { name: "התחלת דיווח קולי" })).toBeEnabled();
  });

  it("classifies when the browser ends the session on silence", async () => {
    await goToDescriptionStep();
    await userEvent.click(micButton());
    const rec = latest();
    rec.hear([["שריפה במחסן", true]]);
    rec.endOfSpeech();

    await waitFor(() => expect(classifyIncidentMock).toHaveBeenCalledWith("שריפה במחסן"));
    expect(rec.stop).not.toHaveBeenCalled();
    expect(await screen.findByText("ניתוח AI (ביטחון: 90%)")).toBeInTheDocument();
  });

  it("doesn't classify a session that heard nothing", async () => {
    await goToDescriptionStep();
    await userEvent.click(micButton());
    latest().fail("no-speech");

    expect(screen.getByText("לא נקלט דיבור — נסו שוב ודברו קרוב למיקרופון.")).toBeInTheDocument();
    expect(micButton()).toBeEnabled();
    expect(classifyIncidentMock).not.toHaveBeenCalled();
  });

  it("offline: keeps the dictated text but leaves classification to the button", async () => {
    const field = await goToDescriptionStep();
    onlineManager.setOnline(false);
    await userEvent.click(micButton());
    const rec = latest();
    rec.hear([["עץ נפל על הגדר", true]]);
    rec.endOfSpeech();

    expect(field.value).toBe("עץ נפל על הגדר");
    expect(screen.getByText(/אין חיבור לרשת — הסיווג האוטומטי לא הופעל/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(classifyIncidentMock).not.toHaveBeenCalled();
  });

  it("typing during a dictation takes over: the session is dropped, nothing is classified", async () => {
    const field = await goToDescriptionStep();
    await userEvent.click(micButton());
    const rec = latest();
    rec.hear([["יש נזילה", false]]);

    await userEvent.type(field, "!");
    expect(rec.abort).toHaveBeenCalled();
    rec.hear([["יש נזילה גדולה", true]]);
    expect(field.value).toBe("יש נזילה!");
    expect(classifyIncidentMock).not.toHaveBeenCalled();
  });

  it("leaving the description step closes the microphone", async () => {
    await goToDescriptionStep();
    await userEvent.click(micButton());
    const rec = latest();

    await userEvent.click(screen.getByRole("button", { name: "חזרה" }));
    expect(rec.abort).toHaveBeenCalled();
  });

  it("a denied microphone disables the button and says why", async () => {
    await goToDescriptionStep();
    await userEvent.click(micButton());
    latest().fail("not-allowed");

    expect(micButton()).toBeDisabled();
    const status = screen.getByRole("status");
    expect(within(status).getByText("דיווח קולי לא זמין")).toBeInTheDocument();
    expect(within(status).getByText(/הגישה למיקרופון נחסמה/)).toBeInTheDocument();
    // The typed flow is untouched.
    await userEvent.type(screen.getByLabelText("תיאור האירוע"), "נזילה");
    expect(screen.getByRole("button", { name: "נתח עם AI" })).toBeEnabled();
  });

  it("a browser without the Web Speech API shows no mic at all", async () => {
    vi.stubGlobal("webkitSpeechRecognition", undefined);
    await goToDescriptionStep();

    expect(screen.queryByRole("button", { name: "התחלת דיווח קולי" })).not.toBeInTheDocument();
    expect(screen.queryByText("דיווח קולי")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("תיאור האירוע"), "נזילה בחניון");
    expect(screen.getByRole("button", { name: "נתח עם AI" })).toBeEnabled();
  });
});
