import { useTheme } from "@mui/material/styles";
import { useMemo } from "react";

import { tokensFor } from "./tokens";
import type { Tokens } from "./tokens";

/** The design tokens for the active color mode (follows the MUI theme's palette.mode,
 * which ColorModeProvider switches). Presentation only. */
export function useTokens(): Tokens {
  const mode = useTheme().palette.mode;
  return useMemo(() => tokensFor(mode), [mode]);
}
