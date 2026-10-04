import AssessmentIcon from "@mui/icons-material/Assessment";
import InsightsIcon from "@mui/icons-material/Insights";
import ShieldIcon from "@mui/icons-material/Shield";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Fade from "@mui/material/Fade";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import { useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { isAxiosError } from "axios";

import { useAuth } from "../auth/AuthContext";
import AmbientBackdrop from "../components/AmbientBackdrop";
import RiskCore3D from "../components/RiskCore3D";
import ThemeToggle from "../components/ThemeToggle";
import { ease, fonts } from "../ui/tokens";
import { useTokens } from "../ui/useTokens";

const FEATURES: { icon: ReactNode; title: string; description: string }[] = [
  {
    icon: <AssessmentIcon />,
    title: "תמונת סיכון מלאה",
    description: "נכסים, סקרי סיכונים, אירועים ותביעות — במקום אחד.",
  },
  {
    icon: <InsightsIcon />,
    title: "תובנות מבוססות AI",
    description: "סיווג אירועים אוטומטי, ניתוח חשיפות וסימולציות VaR.",
  },
  {
    icon: <WarningAmberIcon />,
    title: "התראות בזמן אמת",
    description: "מזג אוויר, פיקוד העורף וחריגות סיכון — ברגע שהן קורות.",
  },
];

/** Login screen (TODO_SPEC.md follow-up: "מסך רישום/התחברות מעוצב ונוח") — a
 * two-panel layout (branding + feature highlights on the right, the actual
 * form on the left) on wide screens, collapsing to a single centered card on
 * mobile. Purely a visual redesign: `useAuth().login` and the email/password
 * fields/labels/button text are unchanged from the previous version, so no
 * server-side change was needed and nothing that depended on this screen's
 * behavior (routing, token storage) is affected. The "Obsidian Aurora" pass restyled it again
 * as a spatial hero (ambient backdrop, native-CSS 3D Risk Core, glass form slab) — still
 * presentation-only. */
export default function Login() {
  const theme = useTheme();
  const { ink, neon, gradients } = useTokens();
  const isDark = theme.palette.mode === "dark";
  const FEATURE_TONES = [neon.violet, neon.cyan, neon.medium];
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      const detail = isAxiosError(err) ? (err.response?.data?.detail as string | undefined) : undefined;
      setError(detail ?? "אירעה שגיאה בהתחברות. נסו שוב.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box
      sx={{
        position: "relative",
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: { xs: 2, sm: 3, md: 5 },
        overflow: "hidden",
      }}
    >
      <AmbientBackdrop />

      <Box sx={{ position: "absolute", top: { xs: 12, md: 24 }, insetInlineStart: { xs: 12, md: 24 }, zIndex: 2 }}>
        <ThemeToggle />
      </Box>

      <Fade in timeout={700}>
        <Box
          sx={{
            position: "relative",
            zIndex: 1,
            width: "100%",
            maxWidth: 1240,
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "1.15fr 1fr" },
            gap: { xs: 3, md: 6 },
            alignItems: "center",
          }}
        >
          {/* Hero / branding column — oversized headline, 3D Risk Core, feature tiles. */}
          <Box sx={{ position: "relative" }}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: { xs: 2, md: 4 } }}>
              <Box
                sx={{
                  width: 46,
                  height: 46,
                  borderRadius: "15px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                  flexShrink: 0,
                  background: `conic-gradient(from 210deg, ${neon.violet}, ${neon.sky}, ${neon.cyan}, ${neon.magenta}, ${neon.violet})`,
                  boxShadow: `0 0 34px -6px ${alpha(neon.violet, 0.95)}`,
                  "&::after": {
                    content: '""',
                    position: "absolute",
                    inset: "1.5px",
                    borderRadius: "13.5px",
                    background: "radial-gradient(circle at 30% 20%, #20275a, #02030A 80%)",
                  },
                }}
              >
                <ShieldIcon
                  sx={{ position: "relative", zIndex: 1, fontSize: 24, color: "#fff", filter: `drop-shadow(0 0 8px ${neon.cyan})` }}
                />
              </Box>
              <Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography
                    variant="h6"
                    sx={{
                      fontFamily: fonts.display,
                      fontWeight: 800,
                      letterSpacing: "0.05em",
                      lineHeight: 1.1,
                      background: gradients.heading,
                      WebkitBackgroundClip: "text",
                      backgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    RMIS
                  </Typography>
                  <Chip
                    label="Demo"
                    size="small"
                    variant="outlined"
                    sx={{
                      height: 18,
                      fontSize: 9.5,
                      fontFamily: fonts.mono,
                      letterSpacing: "0.12em",
                      borderColor: alpha(neon.cyan, 0.5),
                      color: neon.cyan,
                    }}
                  />
                </Stack>
                <Typography
                  variant="caption"
                  sx={{ color: "text.secondary", fontFamily: fonts.mono, letterSpacing: "0.06em", fontSize: 10.5 }}
                >
                  Risk Management Information System
                </Typography>
              </Box>
            </Stack>

            <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 2, md: 3 } }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  component="h1"
                  className="rmis-display"
                  sx={{
                    fontSize: {
                      xs: "2rem !important",
                      sm: "2.6rem !important",
                      md: "clamp(2.8rem, 1.2rem + 2.6vw, 4.4rem) !important",
                    },
                    mb: 2,
                  }}
                >
                  ניהול סיכונים חכם, במקום אחד
                </Typography>
                <Typography
                  variant="body1"
                  sx={{
                    color: "text.secondary",
                    maxWidth: 520,
                    fontSize: { xs: "0.95rem", md: "1.08rem" },
                    lineHeight: 1.7,
                    mb: { xs: 0, md: 4 },
                  }}
                >
                  מהנכס הפיזי ועד הכיסוי הביטוחי — כל מה שצריך כדי לקבל החלטות סיכון מבוססות נתונים.
                </Typography>
              </Box>

              {/* 3D centerpiece beside the headline (hidden on the narrowest phones). */}
              <Box sx={{ display: { xs: "none", sm: "block" }, flexShrink: 0 }}>
                <RiskCore3D size={200} />
              </Box>
            </Box>

            <Box
              sx={{
                display: { xs: "none", md: "grid" },
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 1.5,
                mt: 1,
              }}
            >
              {FEATURES.map((f, i) => {
                const tone = FEATURE_TONES[i % FEATURE_TONES.length];
                return (
                  <Box
                    key={f.title}
                    className="rmis-spot rmis-tilt"
                    sx={{
                      position: "relative",
                      isolation: "isolate",
                      overflow: "hidden",
                      p: 2,
                      borderRadius: "18px",
                      border: `1px solid ${ink.line}`,
                      bgcolor: isDark ? "rgba(13, 19, 44, 0.45)" : "rgba(255, 255, 255, 0.6)",
                      backdropFilter: "blur(18px) saturate(150%)",
                      transform: "perspective(900px) rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg))",
                      transition: `transform 0.7s ${ease.out}, border-color 0.4s`,
                      animation: `rmis-reveal 1s ${ease.out} ${0.25 + i * 0.12}s both`,
                      "&:hover": { borderColor: ink.lineStrong },
                    }}
                  >
                    <Box
                      sx={{
                        width: 36,
                        height: 36,
                        borderRadius: "11px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        mb: 1.5,
                        color: tone,
                        bgcolor: alpha(tone, 0.12),
                        border: `1px solid ${alpha(tone, 0.35)}`,
                        boxShadow: `0 0 22px -6px ${alpha(tone, 0.9)}`,
                        "& svg": { fontSize: 20 },
                      }}
                    >
                      {f.icon}
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5, fontFamily: fonts.display }}>
                      {f.title}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary", lineHeight: 1.5, display: "block" }}>
                      {f.description}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          </Box>

          {/* Form panel — frosted glass slab with an aurora glow. */}
          <Paper
            className="rmis-spot"
            sx={{
              position: "relative",
              isolation: "isolate",
              overflow: "hidden",
              width: "100%",
              maxWidth: 480,
              justifySelf: "center",
              p: { xs: 3, sm: 4.5 },
              borderRadius: { xs: "24px", sm: "30px" },
              bgcolor: isDark ? "rgba(10, 15, 36, 0.55)" : "rgba(255, 255, 255, 0.72)",
              backgroundImage: `radial-gradient(120% 70% at 50% 0%, ${alpha(neon.violet, 0.2)} 0%, transparent 60%)`,
              backdropFilter: "blur(28px) saturate(170%)",
              WebkitBackdropFilter: "blur(28px) saturate(170%)",
              border: `1px solid ${ink.lineStrong}`,
              boxShadow: `0 40px 120px -40px ${isDark ? "rgba(0,0,0,0.95)" : "rgba(30,38,96,0.4)"}, 0 0 90px -40px ${alpha(neon.violet, isDark ? 0.8 : 0.45)}, inset 0 1px 0 ${isDark ? "rgba(255,255,255,0.08)" : "#fff"}`,
              animation: `rmis-dialog-in 1s ${ease.out} 0.1s both`,
            }}
          >
            <Typography
              variant="overline"
              sx={{ display: "flex", alignItems: "center", gap: 1, color: neon.cyan, fontSize: 10.5, lineHeight: 1, mb: 2 }}
            >
              <span className="rmis-pulse" style={{ "--pulse": neon.cyan } as CSSProperties} />
              SECURE ACCESS
            </Typography>

            <Typography
              variant="h5"
              sx={{
                fontFamily: fonts.display,
                fontWeight: 800,
                mb: 0.5,
                letterSpacing: "-0.02em",
                fontSize: { xs: "1.6rem", sm: "1.9rem" },
              }}
            >
              ברוכים הבאים 👋
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3.5 }}>
              התחברו כדי להמשיך למערכת
            </Typography>

            <Stack spacing={2.5} component="form" onSubmit={handleSubmit}>
              {error && (
                <Fade in>
                  <Alert severity="error" variant="filled" sx={{ borderRadius: 2 }}>
                    {error}
                  </Alert>
                </Fade>
              )}

              <TextField
                label="אימייל"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoFocus
                required
                fullWidth
              />
              <TextField
                label="סיסמה"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                fullWidth
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
                        onClick={() => setShowPassword((v) => !v)}
                        edge="end"
                        tabIndex={-1}
                      >
                        {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={submitting}
                fullWidth
                startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : undefined}
                sx={{
                  py: 1.6,
                  fontSize: "1.02rem",
                  fontWeight: 700,
                  borderRadius: "16px",
                  boxShadow: `0 18px 44px -14px ${alpha(theme.palette.primary.main, 0.95)}, inset 0 1px 0 rgba(255,255,255,0.35)`,
                }}
              >
                {submitting ? "מתחבר..." : "התחברות"}
              </Button>

              <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center", pt: 1, opacity: 0.8 }}>
                גרסת הדגמה לקורס ניהול סיכונים — לפרטי כניסה פנו למנהל המערכת.
              </Typography>
            </Stack>
          </Paper>
        </Box>
      </Fade>
    </Box>
  );
}
