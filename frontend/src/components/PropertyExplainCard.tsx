import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useRef, useState } from "react";

import { AiStreamError, streamPropertyExplanation } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useTokens } from "../ui/useTokens";

// Same role set as backend services/ai_orchestrator.FINANCIAL_READ_ROLES: for any other
// role the server leaves claim amounts, loss estimates and mitigation cost/ROI out of the
// prompt (services/property_explain.py). Mirrored here only to say so on the card.
const FINANCIAL_READ_ROLES = ["RISK_MANAGER", "CFO", "PROPERTY_MANAGER", "RISK_OFFICER", "ADJUSTER", "ADMIN"];

type Phase = "idle" | "waiting" | "streaming" | "done" | "error";

interface ExplanationState {
  phase: Phase;
  text: string;
  error: string | null;
}

const IDLE: ExplanationState = { phase: "idle", text: "", error: null };

function errorMessage(err: unknown): string {
  if (err instanceof AiStreamError) {
    switch (err.status) {
      case 503:
        return "שירות ה-AI אינו זמין כרגע: לא הוגדר מפתח API בשרת.";
      case 429:
        return err.message || "חרגת ממכסת הבקשות ל-AI. נסו שוב בעוד דקה.";
      case 403:
        return "אין לתפקידך הרשאה לניתוח AI של הנכס.";
      case 404:
        return "הנכס לא נמצא.";
      case 0:
        return "שירות ה-AI נכשל באמצע הניתוח. נסו שוב.";
    }
  }
  return "שגיאה בפנייה לשירות ה-AI. נסו שוב מאוחר יותר.";
}

/** Runs one streamed "explain this property" request at a time. `start()` is called
 * from click handlers (not an effect), so React's StrictMode double-mount never fires a
 * second, billed request; unmounting or switching property aborts the one in flight. */
export function usePropertyExplanation(propertyId: number) {
  const [state, setState] = useState<ExplanationState>(IDLE);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setState(IDLE);
    return () => controllerRef.current?.abort();
  }, [propertyId]);

  const start = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ phase: "waiting", text: "", error: null });
    streamPropertyExplanation(
      propertyId,
      (text) => {
        if (!controller.signal.aborted) setState({ phase: "streaming", text, error: null });
      },
      controller.signal,
    )
      .then((text) => {
        if (!controller.signal.aborted) setState({ phase: "done", text, error: null });
      })
      .catch((err) => {
        if (!controller.signal.aborted) setState((prev) => ({ phase: "error", text: prev.text, error: errorMessage(err) }));
      });
  }, [propertyId]);

  const close = useCallback(() => {
    controllerRef.current?.abort();
    setState(IDLE);
  }, []);

  return { ...state, running: state.phase === "waiting" || state.phase === "streaming", start, close };
}

const REVEAL_TICK_MS = 16;

/** Typewriter reveal: shows `text` a few characters per frame, speeding up when it falls
 * behind the stream so it never trails the model by more than a moment. Shows it all at
 * once for users who prefer reduced motion. */
function useTypewriter(text: string): string {
  const [shown, setShown] = useState(0);
  const [reduceMotion] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );

  useEffect(() => {
    if (shown > text.length) {
      setShown(0); // a new run cleared the text
      return;
    }
    if (shown === text.length) return;
    if (reduceMotion) {
      setShown(text.length);
      return;
    }
    const id = setTimeout(() => {
      setShown((prev) => Math.min(text.length, prev + Math.max(3, Math.ceil((text.length - prev) / 6))));
    }, REVEAL_TICK_MS);
    return () => clearTimeout(id);
  }, [shown, text.length, reduceMotion]);

  return text.slice(0, shown);
}

interface Props {
  explanation: ReturnType<typeof usePropertyExplanation>;
}

/** Glass card for "הסבר לי את הנכס": a shimmer until the first words arrive, then the
 * analysis typed out live, with regenerate and close. */
export default function PropertyExplainCard({ explanation }: Props) {
  const t = useTokens();
  const { user } = useAuth();
  const { phase, text, error, running, start, close } = explanation;
  const shown = useTypewriter(text);
  const typing = running || shown.length < text.length;

  if (phase === "idle") return null;

  return (
    <Card
      component="section"
      aria-label="ניתוח AI של הנכס"
      sx={{
        borderColor: t.ink.lineStrong,
        "&::before": {
          content: '""',
          position: "absolute",
          insetInline: 0,
          top: 0,
          height: 2,
          background: t.gradients.aurora,
        },
      }}
    >
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <AutoAwesomeIcon fontSize="small" sx={{ color: t.neon.violet }} />
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: 700,
                background: t.gradients.aurora,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              ניתוח AI של הנכס
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.5}>
            <Tooltip title="ניתוח מחדש">
              <span>
                <IconButton size="small" onClick={start} disabled={running} aria-label="ניתוח מחדש">
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="סגירה">
              <IconButton size="small" onClick={close} aria-label="סגירת הניתוח">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        <Box aria-live="polite" aria-busy={running}>
          {phase === "waiting" ? (
            <Stack spacing={0.75} data-testid="explain-loading">
              <Skeleton variant="text" sx={{ fontSize: "1.05rem" }} />
              <Skeleton variant="text" sx={{ fontSize: "1.05rem" }} />
              <Skeleton variant="text" sx={{ fontSize: "1.05rem", width: "62%" }} />
              <Typography variant="caption" color="text.secondary">
                מנתח את נתוני הנכס…
              </Typography>
            </Stack>
          ) : (
            text && (
              <Typography
                data-testid="explain-text"
                sx={{ fontSize: "1.02rem", lineHeight: 1.9, whiteSpace: "pre-wrap", color: "text.primary" }}
              >
                {shown}
                {typing && (
                  <Box
                    component="span"
                    aria-hidden
                    sx={{
                      display: "inline-block",
                      inlineSize: "2px",
                      blockSize: "1.1em",
                      marginInlineStart: "3px",
                      verticalAlign: "text-bottom",
                      borderRadius: "1px",
                      bgcolor: t.neon.violet,
                      boxShadow: `0 0 8px ${t.neon.violet}`,
                      animation: "rmis-caret-blink 1s steps(1) infinite",
                    }}
                  />
                )}
              </Typography>
            )
          )}
        </Box>

        {error && (
          <Alert
            severity="error"
            sx={{ mt: text ? 1.5 : 0 }}
            action={
              <Button color="inherit" size="small" onClick={start}>
                נסו שוב
              </Button>
            }
          >
            {error}
          </Alert>
        )}

        {!!user && !FINANCIAL_READ_ROLES.includes(user.role) && phase !== "error" && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
            נתונים כספיים (סכומי תביעות ועלויות) אינם כלולים בניתוח בהתאם להרשאות התפקיד.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
