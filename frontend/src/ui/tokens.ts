/** Design tokens for the "Obsidian Aurora" spatial UI — the single source of truth for
 * colors, fonts and easing shared by theme.ts, the global stylesheet and the handful of
 * presentational components (KpiCard, charts, RiskMatrix, …) that need raw values
 * rather than MUI palette keys. Presentation only: nothing here feeds app logic. */

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

export const gradients = {
  aurora: `linear-gradient(120deg, ${neon.violet} 0%, ${neon.sky} 55%, ${neon.cyan} 100%)`,
  plasma: `linear-gradient(120deg, ${neon.magenta} 0%, ${neon.violet} 100%)`,
  heading: `linear-gradient(100deg, #FFFFFF 0%, #DCD6FF 38%, ${neon.violet} 70%, ${neon.cyan} 100%)`,
} as const;

/** Categorical series palette for charts — tuned for contrast on the near-black surface. */
export const seriesPalette = [neon.violet, neon.cyan, neon.critical, neon.medium, neon.low, neon.magenta, neon.sky, neon.high];

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
 * onto the neon palette, so callers keep working untouched while rendering in-theme. */
const LEGACY_ACCENTS: Record<string, string> = {
  "#1e5b8a": neon.violet,
  "#c62828": neon.critical,
  "#e69413": neon.medium,
  "#c0521f": neon.high,
  "#2e7d32": neon.low,
  "#5c6bc0": neon.sky,
  "#0277bd": neon.sky,
  "#e64a19": neon.high,
};

export function accent(color: string | undefined, fallback: string = neon.violet): string {
  if (!color) return fallback;
  return LEGACY_ACCENTS[color.toLowerCase()] ?? color;
}
