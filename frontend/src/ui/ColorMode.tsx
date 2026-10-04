import { ThemeProvider } from "@mui/material/styles";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";

import { createAppTheme } from "../theme";
import type { ColorMode } from "./tokens";

/** Light/dark presentation switch.
 *
 * Holds the active color mode, builds the matching MUI theme, mirrors the mode onto
 * `<html data-theme>` (which ui/spatial.css keys its global rules off) and remembers the
 * choice per browser in localStorage. Changing modes animates as a circular "reveal"
 * from the toggle button via the View Transitions API where available, and falls back to
 * an instant swap elsewhere. Purely presentational: no app data or behavior depends on it. */

const STORAGE_KEY = "rmis-color-mode";
const DEFAULT_MODE: ColorMode = "dark";
const THEME_COLORS: Record<ColorMode, string> = { dark: "#02030A", light: "#F3F4FA" };

interface ColorModeContextValue {
  mode: ColorMode;
  /** Switch modes; `origin` (viewport px) is where the reveal animation starts. */
  toggle: (origin?: { x: number; y: number }) => void;
}

const ColorModeContext = createContext<ColorModeContextValue>({
  mode: DEFAULT_MODE,
  toggle: () => {},
});

export const useColorMode = () => useContext(ColorModeContext);

function readStoredMode(): ColorMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage blocked (private mode, sandboxed preview) — fall back to the default.
  }
  return DEFAULT_MODE;
}

function applyModeToDocument(mode: ColorMode) {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[mode]);
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> };
};

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ColorMode>(readStoredMode);

  useEffect(() => {
    applyModeToDocument(mode);
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Not persisted this time; the in-memory mode still applies.
    }
  }, [mode]);

  const toggle = useCallback(
    (origin?: { x: number; y: number }) => {
      const next: ColorMode = mode === "dark" ? "light" : "dark";
      const root = document.documentElement;
      const commit = () => {
        flushSync(() => setMode(next));
        applyModeToDocument(next);
      };

      // Suppress per-element color transitions while swapping, so the whole UI changes
      // in one clean step (inside the reveal) instead of a staggered fade.
      root.classList.add("rmis-theme-switching");
      const release = () => window.setTimeout(() => root.classList.remove("rmis-theme-switching"), 60);

      const doc = document as ViewTransitionDocument;
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      if (!doc.startViewTransition || reduceMotion) {
        commit();
        release();
        return;
      }

      const x = origin?.x ?? window.innerWidth / 2;
      const y = origin?.y ?? 0;
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      const transition = doc.startViewTransition(commit);
      transition.ready
        .then(() => {
          root.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
            { duration: 750, easing: "cubic-bezier(0.65, 0, 0.35, 1)", pseudoElement: "::view-transition-new(root)" },
          );
        })
        .catch(() => {});
      transition.finished.finally(release);
      // Safety net: a backgrounded tab can stall the transition's promises indefinitely.
      window.setTimeout(release, 1500);
    },
    [mode],
  );

  const theme = useMemo(() => createAppTheme(mode), [mode]);
  const value = useMemo(() => ({ mode, toggle }), [mode, toggle]);

  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ColorModeContext.Provider>
  );
}
