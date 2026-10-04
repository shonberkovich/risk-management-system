import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";

import { ease, fonts } from "../ui/tokens";
import { useTokens } from "../ui/useTokens";

/** Glass KPI tile: a glowing accent orb + hairline in the tile's accent color, an
 * oversized tabular figure, and a 3D lean toward the cursor (`.rmis-tilt`, driven by
 * ui/spotlight.ts). Props/contract are unchanged; legacy accent hexes passed by callers
 * are mapped onto the neon palette by `accent()`. */
export default function KpiCard({
  label,
  value,
  subtext,
  trend,
  icon,
  accentColor,
}: {
  label: string;
  value: string;
  subtext?: string;
  trend?: "up" | "down";
  icon?: ReactNode;
  accentColor?: string;
}) {
  const { accent, neon, mode } = useTokens();
  const tone = accent(accentColor);
  const isDark = mode === "dark";

  return (
    <Box className="rmis-tilt" sx={{ height: "100%", perspective: "1000px" }}>
      {/* The tilt lives on this intermediate layer, not on the Card: the Card carries the
          scroll-reveal animation (ui/spatial.css), whose fill would override its transform. */}
      <Box
        sx={{
          height: "100%",
          transform: "rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg))",
          transition: `transform 0.7s ${ease.out}`,
          willChange: "transform",
        }}
      >
      <Card
        sx={{
          height: "100%",
          transition: `box-shadow 0.6s ${ease.out}, border-color 0.6s ${ease.out}`,
          backgroundImage: `radial-gradient(130% 120% at 0% 0%, ${alpha(tone, 0.16)} 0%, transparent 55%), linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0) 40%)`,
          "&:hover": {
            borderColor: alpha(tone, 0.45),
            boxShadow: `inset 0 1px 0 ${isDark ? "rgba(255,255,255,0.08)" : "#fff"}, 0 30px 70px -34px ${alpha(tone, isDark ? 0.85 : 0.55)}`,
          },
        }}
      >
        {/* Accent hairline along the top edge */}
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            top: 0,
            insetInline: "14%",
            height: "1px",
            background: `linear-gradient(90deg, transparent, ${tone}, transparent)`,
            boxShadow: `0 0 14px 1px ${alpha(tone, 0.8)}`,
          }}
        />
        {/* Ambient accent orb */}
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            width: 140,
            height: 140,
            borderRadius: "50%",
            top: -70,
            left: -40,
            background: `radial-gradient(circle, ${alpha(tone, 0.35)} 0%, transparent 70%)`,
            filter: "blur(10px)",
            pointerEvents: "none",
            zIndex: -1,
          }}
        />
        <CardContent sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5} sx={{ flex: 1 }}>
            <Stack spacing={1} sx={{ minWidth: 0 }}>
              <Typography
                variant="caption"
                sx={{ fontWeight: 600, color: "text.secondary", letterSpacing: "0.04em", lineHeight: 1.35 }}
              >
                {label}
              </Typography>
              <Typography
                variant="h5"
                sx={{
                  fontFamily: fonts.numeric,
                  fontWeight: 700,
                  fontSize: "clamp(1.55rem, 1.1rem + 1.1vw, 2.15rem)",
                  lineHeight: 1.05,
                  letterSpacing: "-0.03em",
                  color: "text.primary",
                  textShadow: `0 0 28px ${alpha(tone, isDark ? 0.45 : 0.22)}`,
                  fontVariantNumeric: "tabular-nums",
                  overflowWrap: "anywhere",
                  transform: "translateZ(30px)",
                }}
              >
                {value}
              </Typography>
              {subtext && (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {trend === "up" && (
                    <ArrowUpwardIcon fontSize="inherit" sx={{ color: neon.critical, filter: `drop-shadow(0 0 4px ${neon.critical})` }} />
                  )}
                  {trend === "down" && (
                    <ArrowDownwardIcon fontSize="inherit" sx={{ color: neon.low, filter: `drop-shadow(0 0 4px ${neon.low})` }} />
                  )}
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: fonts.numeric }}>
                    {subtext}
                  </Typography>
                </Stack>
              )}
            </Stack>
            {icon && (
              <Box
                sx={{
                  flexShrink: 0,
                  width: 46,
                  height: 46,
                  borderRadius: "14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: tone,
                  bgcolor: alpha(tone, 0.1),
                  border: `1px solid ${alpha(tone, 0.3)}`,
                  boxShadow: `0 0 26px -8px ${alpha(tone, isDark ? 0.9 : 0.6)}, inset 0 1px 0 ${isDark ? "rgba(255,255,255,0.08)" : "#fff"}`,
                  transform: "translateZ(40px)",
                  "& .MuiSvgIcon-root": {
                    fontSize: 24,
                    color: `${tone} !important`,
                    filter: `drop-shadow(0 0 6px ${alpha(tone, 0.8)})`,
                  },
                }}
              >
                {icon}
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>
      </Box>
    </Box>
  );
}
