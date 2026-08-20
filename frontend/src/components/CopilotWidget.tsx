import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SendIcon from "@mui/icons-material/Send";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Fab from "@mui/material/Fab";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { isAxiosError } from "axios";
import { useEffect, useRef, useState } from "react";

import { askQuestion } from "../api/client";

interface Turn {
  question: string;
  answer: string | null;
  error: string | null;
}

const SUGGESTED_QUESTIONS = [
  "מהו ה-TIV הכולל של תיק הנכסים?",
  "אילו נכסים נמצאים בדירוג סיכון גבוה?",
  "מהו יחס ההפסדים (Loss Ratio) הנוכחי?",
];

/** Floating natural-language Q&A widget over POST /api/ai/ask (services/llm.ask_question) —
 * a fixed-position FAB that expands into a small chat panel. Visible on every authenticated
 * page (mounted once in Layout, not per-route) so a risk manager can ask an ad-hoc question
 * about the portfolio without leaving whatever screen they're on. `llm.ask_question` only
 * ever answers from its five fixed query tools (see CLAUDE.md's "AI tool-use Q&A is
 * deliberately constrained" note) — this widget is just a UI shell around that existing,
 * already-guarded endpoint; it adds no new data access. */
export default function CopilotWidget() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, loading, open]);

  const submit = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setQuestion("");
    setTurns((prev) => [...prev, { question: trimmed, answer: null, error: null }]);
    setLoading(true);
    try {
      const { answer } = await askQuestion(trimmed);
      setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 ? { ...t, answer } : t)));
    } catch (err) {
      let message = "שגיאה בפנייה לשירות ה-AI. נסו שוב מאוחר יותר.";
      if (isAxiosError(err)) {
        if (err.response?.status === 503) {
          message = "שירות ה-AI אינו מוגדר כרגע (חסר מפתח API בצד השרת).";
        } else if (err.response?.status === 429) {
          message = "יותר מדי בקשות בזמן קצר — נסו שוב בעוד רגע.";
        } else if (err.response?.data?.detail) {
          message = String(err.response.data.detail);
        }
      }
      setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 ? { ...t, error: message } : t)));
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <Tooltip title="סייר AI — שאלו שאלה על נתוני המערכת" placement="left">
        <Fab
          color="primary"
          onClick={() => setOpen(true)}
          sx={{ position: "fixed", bottom: 24, insetInlineEnd: 24, zIndex: 1300 }}
        >
          <SmartToyIcon />
        </Fab>
      </Tooltip>
    );
  }

  return (
    <Paper
      elevation={8}
      sx={{
        position: "fixed",
        bottom: 24,
        insetInlineEnd: 24,
        width: { xs: "calc(100vw - 32px)", sm: 380 },
        height: 480,
        maxHeight: "70vh",
        display: "flex",
        flexDirection: "column",
        borderRadius: 2,
        overflow: "hidden",
        zIndex: 1300,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 2, py: 1.5, bgcolor: "primary.main", color: "primary.contrastText" }}
      >
        <SmartToyIcon fontSize="small" />
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flexGrow: 1 }}>
          סייר AI — שאלות ותשובות
        </Typography>
        {turns.length > 0 && (
          <Tooltip title="נקה שיחה">
            <IconButton size="small" onClick={() => setTurns([])} sx={{ color: "inherit" }}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <IconButton size="small" onClick={() => setOpen(false)} sx={{ color: "inherit" }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Box ref={scrollRef} sx={{ flexGrow: 1, overflowY: "auto", p: 2 }}>
        {turns.length === 0 ? (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              שאלו שאלה בשפה חופשית על נתוני הנכסים, הסיכונים, התביעות או המיטיגציה — התשובה
              מבוססת אך ורק על נתוני המערכת.
            </Typography>
            <Stack spacing={0.75}>
              {SUGGESTED_QUESTIONS.map((sq) => (
                <Paper
                  key={sq}
                  variant="outlined"
                  onClick={() => submit(sq)}
                  sx={{ p: 1, cursor: "pointer", fontSize: 13, "&:hover": { bgcolor: "grey.50" } }}
                >
                  {sq}
                </Paper>
              ))}
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            {turns.map((turn, i) => (
              <Stack key={i} spacing={1}>
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Paper sx={{ px: 1.5, py: 1, bgcolor: "primary.main", color: "primary.contrastText", maxWidth: "85%" }}>
                    <Typography variant="body2">{turn.question}</Typography>
                  </Paper>
                </Stack>
                <Stack direction="row" spacing={1} alignItems="flex-start">
                  <Avatar sx={{ width: 24, height: 24, bgcolor: "grey.300" }}>
                    <SmartToyIcon sx={{ fontSize: 16 }} />
                  </Avatar>
                  {turn.error ? (
                    <Alert severity="warning" sx={{ py: 0, maxWidth: "85%" }}>
                      {turn.error}
                    </Alert>
                  ) : turn.answer !== null ? (
                    <Paper variant="outlined" sx={{ px: 1.5, py: 1, maxWidth: "85%", bgcolor: "grey.50" }}>
                      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                        {turn.answer}
                      </Typography>
                    </Paper>
                  ) : (
                    <CircularProgress size={16} sx={{ mt: 1 }} />
                  )}
                </Stack>
              </Stack>
            ))}
          </Stack>
        )}
      </Box>

      <Stack direction="row" spacing={1} sx={{ p: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
        <TextField
          size="small"
          fullWidth
          placeholder="שאלו שאלה..."
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(question);
            }
          }}
          disabled={loading}
        />
        <IconButton color="primary" onClick={() => submit(question)} disabled={loading || !question.trim()}>
          <SendIcon />
        </IconButton>
      </Stack>
    </Paper>
  );
}
