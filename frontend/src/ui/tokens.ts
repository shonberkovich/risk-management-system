/** Design tokens for the RMIS spatial UI — the single source of truth for colors,
 * fonts and easing shared by theme.ts, the global stylesheet and the presentational
 * components that need raw values rather than MUI palette keys.
 *
 * Two modes:
 *  - "dark"  → "Obsidian Aurora": OLED black / midnight glass, neon accents.
 *  - "light" → "Porcelain Aurora": cool porcelain / frosted white glass, the same
 *              accent hues deepened so they keep contrast on light surfaces.
 * Components read the active set via `useTokens()` (ui/useTokens.ts). The bare
 * `ink` / `neon` / `gradients` exports below are the dark set, kept for callers
 * that don't depend on the mode. Presentation only: nothing here feeds app logic. */

export type ColorMode = "light" | "dark";

export const ink = {
  void: "#02030A", // OLED base
  abyss: "#050817",
  midnight: "#0A0F24",
  deep: "#0F1631",
  slate: "#18213F",
  line: "rgba(148, 163, 255, 0.10)",
  lineStrong: "rgba(148, 163, 255, 0.22)",
  text: "#EEF1FF",
  textDim: "#A3ACCF",
  textMute: "#6C7699",
} as const;

export const inkLight = {
  void: "#F3F4FA", // porcelain base
  abyss: "#ECEEF7",
  midnight: "#FFFFFF",
  deep: "#F7F8FD",
  slate: "#E3E7F4",
  line: "rgba(30, 38, 96, 0.09)",
  lineStrong: "rgba(30, 38, 96, 0.17)",
  text: "#0B1030",
  textDim: "#4A5277",
  textMute: "#7D84A6",
} as const;

export const neon = {
  violet: "#8B7BFF",
  violetDeep: "#5B45F5",
  cyan: "#2EE6D6",
  sky: "#4CC9F0",
  magenta: "#F45FD1",
  critical: "#FF4D79",
  high: "#FF8A4C",
  medium: "#FFC857",
  low: "#2BE4A7",
} as const;

/** Same hues as `neon`, deepened for ≥3:1 contrast against porcelain/white glass. */
export const neonLight = {
  violet: "#6650F2",
  violetDeep: "#4A32DE",
  cyan: "#0AA597",
  sky: "#0A8FC6",
  magenta: "#CF35AE",
  critical: "#E2245B",
  high: "#E0631A",
  medium: "#C98A00",
  low: "#0C9A6A",
} as const;

export type InkSet = { [K in keyof typeof ink]: string };
export type NeonSet = { [K in keyof typeof neon]: string };

const makeGradients = (n: NeonSet, mode: ColorMode) => ({
  aurora: `linear-gradient(120deg, ${n.violet} 0%, ${n.sky} 55%, ${n.cyan} 100%)`,
  plasma: `linear-gradient(120deg, ${n.magenta} 0%, ${n.violet} 100%)`,
  heading:
    mode === "dark"
      ? `linear-gradient(100deg, #FFFFFF 0%, #DCD6FF 38%, ${n.violet} 70%, ${n.cyan} 100%)`
      : `linear-gradient(100deg, #0B1030 0%, #2B2378 36%, ${n.violet} 70%, ${n.sky} 100%)`,
});

export const gradients = makeGradients(neon, "dark");

const makeSeries = (n: NeonSet) => [n.violet, n.cyan, n.critical, n.medium, n.low, n.magenta, n.sky, n.high];

/** Categorical series palette for charts (dark set). */
export const seriesPalette = makeSeries(neon);

export const fonts = {
  display: '"Rubik Variable", "Heebo Variable", "Segoe UI", system-ui, sans-serif',
  body: '"Heebo Variable", "Rubik Variable", "Segoe UI", system-ui, sans-serif',
  // "RMIS Digits" is JetBrains Mono restricted (via unicode-range, see ui/fonts.ts) to
  // digits and numeric punctuation, so figures render monospaced/tabular while any
  // Hebrew in the same string falls through to Heebo.
  numeric: '"RMIS Digits", "Heebo Variable", "Segoe UI", system-ui, sans-serif',
  mono: '"JetBrains Mono Variable", ui-monospace, "Cascadia Code", Consolas, monospace',
} as const;

export const ease = {
  out: "cubic-bezier(0.16, 1, 0.3, 1)", // expo-out: confident, settles softly
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;

/** Maps the legacy accent hexes still passed around as props (accentColor="#1e5b8a", …)
 * onto neon palette *keys*, so callers keep working untouched while rendering in-theme. */
const LEGACY_ACCENTS: Record<string, keyof NeonSet> = {
  "#1e5b8a": "violet",
  "#c62828": "critical",
  "#e69413": "medium",
  "#c0521f": "high",
  "#2e7d32": "low",
  "#5c6bc0": "sky",
  "#0277bd": "sky",
  "#e64a19": "high",
};

/** Reverse lookup: any dark-set neon hex → its key, so `adapt()` can swap it for the
 * light-set equivalent (used for module-level color constants such as pill options). */
const NEON_KEY_BY_HEX: Record<string, keyof NeonSet> = Object.fromEntries(
  (Object.keys(neon) as (keyof NeonSet)[]).map((key) => [neon[key].toLowerCase(), key]),
);

/** Light-mode stand-ins for the few off-palette pastel hexes used as option colors
 * (incident-report hazard pills), which are too pale to read on porcelain. */
const EXTRA_LIGHT_EQUIVALENTS: Record<string, string> = {
  "#d9a47a": "#9A6235",
  "#b79cff": "#7B4FE0",
  "#a3accf": "#5A6187",
};

export function tokensFor(mode: ColorMode) {
  const n: NeonSet = mode === "dark" ? neon : neonLight;
  const i: InkSet = mode === "dark" ? ink : inkLight;
  return {
    mode,
    ink: i,
    neon: n,
    gradients: makeGradients(n, mode),
    seriesPalette: makeSeries(n),
    /** Legacy accent hex → this mode's neon (unknown colors pass through). */
    accent(color: string | undefined, fallback: string = n.violet): string {
      if (!color) return fallback;
      const key = LEGACY_ACCENTS[color.toLowerCase()];
      return key ? n[key] : color;
    },
    /** Dark-set neon hex → this mode's equivalent (unknown colors pass through). */
    adapt(color: string): string {
      const hex = color.toLowerCase();
      const key = NEON_KEY_BY_HEX[hex];
      if (key) return n[key];
      return mode === "light" ? (EXTRA_LIGHT_EQUIVALENTS[hex] ?? color) : color;
    },
  };
}

export type Tokens = ReturnType<typeof tokensFor>;

/** Dark-set accent mapping, kept for mode-independent callers. */
export function accent(color: string | undefined, fallback: string = neon.violet): string {
  return tokensFor("dark").accent(color, fallback);
}
