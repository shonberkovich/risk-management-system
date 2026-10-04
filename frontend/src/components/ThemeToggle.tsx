import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { alpha } from "@mui/material/styles";
import type { MouseEvent } from "react";

import { useColorMode } from "../ui/ColorMode";
import { ease } from "../ui/tokens";
import { useTokens } from "../ui/useTokens";

/** Light/dark switch. `icon` (default) is the round glass button used in the navbar and
 * on the login screen — a sun and a moon that rotate/crossfade into each other; `row`
 * is a full-width button for the navigation drawer. Presentation only. */
export default function ThemeToggle({ variant = "icon" }: { variant?: "icon" | "row" }) {
  const { mode, toggle } = useColorMode();
  const { neon } = useTokens();
  const isDark = mode === "dark";
  const label = isDark ? "מעבר למצב בהיר" : "מעבר למצב כהה";

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    toggle({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  if (variant === "row") {
    return (
      <Button
        fullWidth
        variant="outlined"
        color="inherit"
        onClick={handleClick}
        startIcon={isDark ? <LightModeRoundedIcon /> : <DarkModeRoundedIcon />}
        aria-label={label}
        data-testid="theme-toggle-row"
      >
        {isDark ? "מצב בהיר" : "מצב כהה"}
      </Button>
    );
  }

  const iconSx = (visible: boolean, tone: string) => ({
    position: "absolute",
    fontSize: 20,
    color: tone,
    filter: `drop-shadow(0 0 6px ${alpha(tone, 0.7)})`,
    opacity: visible ? 1 : 0,
    transform: visible ? "rotate(0deg) scale(1)" : "rotate(-120deg) scale(0.4)",
    transition: `opacity 0.45s ${ease.out}, transform 0.6s ${ease.spring}`,
  });

  return (
    <Tooltip title={label}>
      <IconButton
        onClick={handleClick}
        aria-label={label}
        data-testid="theme-toggle"
        sx={{
          position: "relative",
          width: { xs: 34, sm: 40 },
          height: { xs: 34, sm: 40 },
          overflow: "hidden",
          bgcolor: isDark ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.7)",
          border: `1px solid ${isDark ? "rgba(148, 163, 255, 0.12)" : "rgba(30, 38, 96, 0.12)"}`,
        }}
      >
        {/* Shows the mode you'd switch *to*: a sun in dark mode, a moon in light mode. */}
        <Box component="span" sx={{ position: "relative", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <LightModeRoundedIcon sx={iconSx(isDark, neon.medium)} />
          <DarkModeRoundedIcon sx={iconSx(!isDark, neon.violet)} />
        </Box>
      </IconButton>
    </Tooltip>
  );
}
