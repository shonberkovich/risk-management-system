import { useCallback, useEffect, useRef, useState } from "react";

/** Voice dictation over the browser's Web Speech API (Chrome/Edge/Safari, desktop and
 * mobile; not Firefox). One recognition session per start(): interim results stream to
 * onTranscript as the user speaks, and onEnd gets the final text once the session ends
 * cleanly — the user tapped stop, or the browser detected the end of speech.
 *
 * Sessions run with continuous=false, so the browser's own end-of-speech detection is
 * what stops it on silence (continuous mode duplicates results on Android Chrome); the
 * timer below is only a backstop for browsers that keep the session open. */

// The DOM lib has no Web Speech recognition types — only what this hook touches.
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { readonly transcript: string };
}
interface SpeechRecognitionEventLike {
  readonly results: { readonly length: number; readonly [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

// Backstops: stop after this long with no new words, or with no speech at all.
export const SILENCE_STOP_MS = 3500;
export const NO_SPEECH_STOP_MS = 8000;

const DENIED_MESSAGE = "הגישה למיקרופון נחסמה — יש לאפשר אותה בהגדרות הדפדפן כדי לדווח בקול.";
const INSECURE_MESSAGE = "דיווח קולי זמין רק בחיבור מאובטח (HTTPS).";
const NO_SPEECH_MESSAGE = "לא נקלט דיבור — נסו שוב ודברו קרוב למיקרופון.";
const GENERIC_MESSAGE = "זיהוי הדיבור נכשל — נסו שוב או הקלידו את התיאור.";

// Errors that make dictation unusable until something outside the page changes:
// the button is disabled and shows the reason.
const BLOCKING_ERRORS: Record<string, string> = {
  "not-allowed": DENIED_MESSAGE,
  "service-not-allowed": "שירות זיהוי הדיבור אינו זמין בדפדפן או במכשיר זה.",
  "language-not-supported": "זיהוי דיבור בעברית אינו נתמך בדפדפן זה.",
};
// One-off failures: shown once, the next tap tries again.
const ERROR_MESSAGES: Record<string, string> = {
  "no-speech": NO_SPEECH_MESSAGE,
  "audio-capture": "לא נמצא מיקרופון פעיל במכשיר.",
  network: "זיהוי הדיבור דורש חיבור לרשת — נסו שוב כשהחיבור יחזור.",
};

type Session = { rec: SpeechRecognitionLike; transcript: string; failed: boolean; cancelled: boolean };

export interface SpeechDictation {
  /** The browser has a speech recognizer at all — when false, hide the control. */
  supported: boolean;
  listening: boolean;
  /** Why dictation can't be used right now (mic denied, no HTTPS…), or null. */
  blockedReason: string | null;
  /** The last session's one-off failure (no speech heard, no mic…), or null. */
  error: string | null;
  start(): void;
  /** Ends the session gracefully: the final words still arrive, then onEnd. */
  stop(): void;
  /** Drops the session: no further onTranscript, no onEnd. */
  cancel(): void;
}

export function useSpeechDictation(options: {
  lang: string;
  onTranscript: (text: string) => void;
  onEnd: (text: string) => void;
}): SpeechDictation {
  const { lang } = options;
  const [supported] = useState(() => recognitionCtor() !== undefined);
  const [listening, setListening] = useState(false);
  const [blockedReason, setBlockedReason] = useState<string | null>(() =>
    supported && typeof window !== "undefined" && window.isSecureContext === false ? INSECURE_MESSAGE : null,
  );
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const callbacksRef = useRef(options);
  useEffect(() => {
    callbacksRef.current = options;
  });

  const clearTimer = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }, []);

  const armTimer = useCallback(
    (session: Session, ms: number) => {
      clearTimer();
      timerRef.current = window.setTimeout(() => session.rec.stop(), ms);
    },
    [clearTimer],
  );

  // A microphone denied in site settings: disable up front instead of failing on tap,
  // and re-enable if the user allows it while the page is open. Not every browser can
  // query "microphone" (Firefox rejects it) — then the first tap's error tells us.
  const permissionRef = useRef<PermissionStatus | null>(null);
  useEffect(() => {
    if (!supported || !navigator.permissions?.query) return;
    let alive = true;
    const apply = () => {
      if (permissionRef.current?.state === "denied") setBlockedReason(DENIED_MESSAGE);
      else setBlockedReason((current) => (current === DENIED_MESSAGE ? null : current));
    };
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((status) => {
        if (!alive) return;
        permissionRef.current = status;
        apply();
        status.addEventListener("change", apply);
      })
      .catch(() => {});
    return () => {
      alive = false;
      permissionRef.current?.removeEventListener("change", apply);
      permissionRef.current = null;
    };
  }, [supported]);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || blockedReason || sessionRef.current) return;
    setError(null);
    let rec: SpeechRecognitionLike;
    try {
      rec = new Ctor();
    } catch {
      setError(GENERIC_MESSAGE);
      return;
    }
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    const session: Session = { rec, transcript: "", failed: false, cancelled: false };

    rec.onresult = (event) => {
      if (session.cancelled) return;
      // Rebuilt from every result each time, so an interim guess is replaced (not
      // appended to) once the recognizer settles on the final words.
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += ` ${event.results[i][0]?.transcript ?? ""}`;
      session.transcript = text.replace(/\s+/g, " ").trim();
      callbacksRef.current.onTranscript(session.transcript);
      armTimer(session, SILENCE_STOP_MS);
    };
    rec.onerror = (event) => {
      if (session.cancelled || event.error === "aborted") return;
      session.failed = true;
      // A dismissed (not denied) permission prompt also reports "not-allowed"; the
      // next tap prompts again, so don't lock the button for it.
      const dismissed = event.error === "not-allowed" && permissionRef.current?.state === "prompt";
      const blocked = dismissed ? undefined : BLOCKING_ERRORS[event.error];
      if (dismissed) setError("לא ניתנה גישה למיקרופון — הקישו שוב ואשרו את הבקשה.");
      else if (blocked) setBlockedReason(blocked);
      else setError(ERROR_MESSAGES[event.error] ?? GENERIC_MESSAGE);
    };
    rec.onend = () => {
      if (sessionRef.current === session) {
        sessionRef.current = null;
        clearTimer();
        setListening(false);
      }
      if (session.cancelled || session.failed) return;
      if (!session.transcript) setError(NO_SPEECH_MESSAGE);
      else callbacksRef.current.onEnd(session.transcript);
    };

    sessionRef.current = session;
    try {
      rec.start();
    } catch {
      sessionRef.current = null;
      setError(GENERIC_MESSAGE);
      return;
    }
    setListening(true);
    armTimer(session, NO_SPEECH_STOP_MS);
  }, [armTimer, blockedReason, clearTimer, lang]);

  const stop = useCallback(() => {
    sessionRef.current?.rec.stop();
  }, []);

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.cancelled = true;
    sessionRef.current = null;
    clearTimer();
    setListening(false);
    session.rec.abort();
  }, [clearTimer]);

  // Never leave the microphone open behind an unmounted page.
  useEffect(() => cancel, [cancel]);

  return { supported, listening, blockedReason, error, start, stop, cancel };
}
