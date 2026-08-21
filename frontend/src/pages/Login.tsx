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
import type { FormEvent, ReactNode } from "react";
import { isAxiosError } from "axios";

import { useAuth } from "../auth/AuthContext";

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
 * behavior (routing, token storage) is affected. */
export default function Login() {
  const theme = useTheme();
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
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `linear-gradient(160deg, ${theme.palette.primary.dark ?? theme.palette.primary.main} 0%, ${theme.palette.primary.main} 45%, ${theme.palette.secondary.main} 130%)`,
        p: { xs: 2, sm: 3 },
      }}
    >
      <Fade in timeout={400}>
        <Paper
          elevation={12}
          sx={{
            width: "100%",
            maxWidth: 920,
            borderRadius: 4,
            overflow: "hidden",
            display: "flex",
            boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          }}
        >
          {/* Branding / feature panel — hidden on mobile so the form always gets full width there. */}
          <Box
            sx={{
              display: { xs: "none", md: "flex" },
              flexDirection: "column",
              justifyContent: "space-between",
              width: 360,
              flexShrink: 0,
              p: 4,
              color: "#fff",
              background: `linear-gradient(150deg, ${alpha(theme.palette.secondary.main, 0.95)}, ${alpha(theme.palette.primary.dark ?? theme.palette.primary.main, 0.95)})`,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Purely decorative background circles — echoes the gradient badge used in Navbar.tsx. */}
            <Box sx={{ position: "absolute", inset: 0, opacity: 0.15, pointerEvents: "none" }}>
              <Box sx={{ position: "absolute", width: 260, height: 260, borderRadius: "50%", bgcolor: "#fff", top: -100, insetInlineStart: -80 }} />
              <Box sx={{ position: "absolute", width: 180, height: 180, borderRadius: "50%", bgcolor: "#fff", bottom: -60, insetInlineEnd: -60 }} />
            </Box>

            <Box sx={{ position: "relative" }}>
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 4 }}>
                <Box
                  sx={{
                    width: 46,
                    height: 46,
                    borderRadius: 2.5,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: alpha("#fff", 0.18),
                    backdropFilter: "blur(4px)",
                  }}
                >
                  <ShieldIcon sx={{ fontSize: 26 }} />
                </Box>
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: 0.3 }}>
                      RMIS
                    </Typography>
                    <Chip
                      label="Demo"
                      size="small"
                      variant="outlined"
                      sx={{ height: 18, fontSize: 10, borderColor: alpha("#fff", 0.5), color: alpha("#fff", 0.9) }}
                    />
                  </Stack>
                  <Typography variant="caption" sx={{ opacity: 0.85 }}>
                    Risk Management Information System
                  </Typography>
                </Box>
              </Stack>

              <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.35, mb: 1 }}>
                ניהול סיכונים חכם, במקום אחד
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.85, mb: 4 }}>
                מהנכס הפיזי ועד הכיסוי הביטוחי — כל מה שצריך כדי לקבל החלטות סיכון מבוססות נתונים.
              </Typography>
            </Box>

            <Stack spacing={2.5} sx={{ position: "relative" }}>
              {FEATURES.map((f) => (
                <Stack key={f.title} direction="row" spacing={1.5} alignItems="flex-start">
                  <Box
                    sx={{
                      width: 34,
                      height: 34,
                      borderRadius: 1.5,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      bgcolor: alpha("#fff", 0.16),
                    }}
                  >
                    {f.icon}
                  </Box>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {f.title}
                    </Typography>
                    <Typography variant="caption" sx={{ opacity: 0.8 }}>
                      {f.description}
                    </Typography>
                  </Box>
                </Stack>
              ))}
            </Stack>
          </Box>

          {/* Form panel */}
          <Box sx={{ flex: 1, p: { xs: 3.5, sm: 5 }, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <Stack spacing={0.5} sx={{ mb: 3, display: { xs: "flex", md: "none" } }} alignItems="center">
              <Stack direction="row" spacing={1} alignItems="center">
                <ShieldIcon color="primary" />
                <Typography variant="h5" sx={{ fontWeight: 800 }}>
                  RMIS
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                מערכת ניהול סיכונים
              </Typography>
            </Stack>

            <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5, display: { xs: "none", md: "block" } }}>
              ברוכים הבאים 👋
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3, display: { xs: "none", md: "block" } }}>
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
                  py: 1.4,
                  fontSize: "1rem",
                  fontWeight: 700,
                  boxShadow: `0 8px 20px ${alpha(theme.palette.primary.main, 0.35)}`,
                }}
              >
                {submitting ? "מתחבר..." : "התחברות"}
              </Button>

              <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center", pt: 1 }}>
                גרסת הדגמה לקורס ניהול סיכונים — לפרטי כניסה פנו למנהל המערכת.
              </Typography>
            </Stack>
          </Box>
        </Paper>
      </Fade>
    </Box>
  );
}
