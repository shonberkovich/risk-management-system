/**
 * useSpeechDictation's own safety nets, below the page: the silence backstop for
 * browsers that keep a session open, and the microphone-permission / secure-context
 * checks that disable dictation instead of letting it fail on every tap.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NO_SPEECH_STOP_MS, SILENCE_STOP_MS, useSpeechDictation } from "./useSpeechDictation";

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
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn(() => this.onend?.());
  constructor() {
    FakeRecognition.instances.push(this);
  }
  hear(text: string, isFinal: boolean) {
    act(() => this.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal })] }));
  }
}

const latest = () => FakeRecognition.instances[FakeRecognition.instances.length - 1];

function fakePermission(state: PermissionState) {
  const status = Object.assign(new EventTarget(), { state });
  vi.stubGlobal("navigator", {
    ...navigator,
    permissions: { query: vi.fn().mockResolvedValue(status) },
  });
  return status;
}

function renderDictation() {
  const onTranscript = vi.fn();
  const onEnd = vi.fn();
  const hook = renderHook(() => useSpeechDictation({ lang: "he-IL", onTranscript, onEnd }));
  return { ...hook, onTranscript, onEnd };
}

describe("useSpeechDictation", () => {
  beforeEach(() => {
    FakeRecognition.instances = [];
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stops on its own after a pause in speech, and after no speech at all", () => {
    vi.useFakeTimers();
    const { result, onEnd } = renderDictation();

    act(() => result.current.start());
    const rec = latest();
    expect(rec.continuous).toBe(false);
    rec.hear("יש נזילה", false);
    act(() => vi.advanceTimersByTime(SILENCE_STOP_MS - 100));
    rec.hear("יש נזילה בחניון", true); // still talking: the countdown restarts
    act(() => vi.advanceTimersByTime(SILENCE_STOP_MS - 100));
    expect(rec.stop).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(rec.stop).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith("יש נזילה בחניון");
    expect(result.current.listening).toBe(false);

    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(NO_SPEECH_STOP_MS));
    expect(latest().stop).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(result.current.error).toMatch(/לא נקלט דיבור/);
  });

  it("a microphone denied in site settings disables dictation up front, and allowing it re-enables", async () => {
    const status = fakePermission("denied");
    const { result } = renderDictation();
    await waitFor(() => expect(result.current.blockedReason).toMatch(/הגישה למיקרופון נחסמה/));

    act(() => result.current.start());
    expect(FakeRecognition.instances).toHaveLength(0);

    act(() => {
      status.state = "granted";
      status.dispatchEvent(new Event("change"));
    });
    expect(result.current.blockedReason).toBeNull();
  });

  it("a dismissed permission prompt doesn't lock the button — the next tap asks again", async () => {
    fakePermission("prompt");
    const { result } = renderDictation();
    await waitFor(() => expect(navigator.permissions.query).toHaveBeenCalled());

    act(() => result.current.start());
    act(() => {
      latest().onerror?.({ error: "not-allowed" });
      latest().onend?.();
    });
    expect(result.current.blockedReason).toBeNull();
    expect(result.current.error).toMatch(/הקישו שוב ואשרו/);
  });

  it("is unavailable outside a secure context (a phone on plain http)", () => {
    vi.stubGlobal("isSecureContext", false);
    const { result } = renderDictation();
    expect(result.current.supported).toBe(true);
    expect(result.current.blockedReason).toMatch(/HTTPS/);
  });

  it("closes the microphone when the page unmounts", () => {
    const { result, unmount, onEnd } = renderDictation();
    act(() => result.current.start());
    const rec = latest();
    unmount();
    expect(rec.abort).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();
  });
});
