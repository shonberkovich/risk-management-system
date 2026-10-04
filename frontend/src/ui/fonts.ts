// Self-hosted variable fonts (bundled by Vite, so they also work offline in the PWA shell).
import "@fontsource-variable/heebo";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/rubik";
import jetbrainsMonoLatin from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url";

/** "RMIS Digits": JetBrains Mono, but only for digits and numeric punctuation
 * (0-9 % + − , . : / ₪ $ €). Used first in fonts.numeric so figures in tables and KPI
 * tiles render monospaced and tabular, while Hebrew in the same string falls through
 * to the next family in the stack. Injected through MuiCssBaseline in theme.ts. */
export const digitsFontFace = `
@font-face {
  font-family: "RMIS Digits";
  font-style: normal;
  font-display: swap;
  font-weight: 100 800;
  src: url("${jetbrainsMonoLatin}") format("woff2-variations");
  unicode-range: U+0025, U+002B-002F, U+0030-003A, U+0024, U+2212, U+20AA, U+20AC;
}
`;
