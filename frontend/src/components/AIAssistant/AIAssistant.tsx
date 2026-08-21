import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SendIcon from "@mui/icons-material/Send";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
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

import {
  proposeMitigationTask,
  sendAgentChatMessage,
  type ActionProposal,
  type AgentType,
} from "../../api/client";
import ActionCard from "./ActionCard";
import { useAIAssistant } from "./AIAssistantContext";

interface AgentTurn {
  role: "user" | "agent";
  text: string;
  agent?: AgentType;
  actionCard?: { actionId: number; proposal: ActionProposal };
  error?: string;
}

// Progressive ("typewriter") reveal of an agent answer already fully received.
// The orchestrator's routing decision has to finish before any agent output
// exists at all (unlike executive-summary's real token stream, which starts
// writing immediately) — so this is a client-side approximation of streaming
// rather than a true SSE/incremental read, chosen to keep TODO_SPEC.md §6's
// "answer appears gradually, like ChatGPT" UX without reworking the
// orchestrator's single-JSON-response shape. Mounts once per turn (turns are
// append-only, so index-as-key never remounts an existing turn).
const REVEAL_CHARS_PER_TICK = 4;
const REVEAL_TICK_MS = 12;

function StreamedAnswer({ text }: { text: string }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown >= text.length) return;
    const id = setInterval(() => {
      setShown((prev) => Math.min(prev + REVEAL_CHARS_PER_TICK, text.length));
    }, REVEAL_TICK_MS);
    return () => clearInterval(id);
  }, [shown, text.length]);

  return <>{text.slice(0, shown)}</>;
}

const SUGGESTED_QUESTIONS = [
  "מהו ה-TIV הכולל של תיק הנכסים?",
  "האם יש התרעות מזג אוויר פעילות?",
  "אילו נכסים חורגים מתאימות לתקן ISO 31000?",
];

const AGENT_LABELS: Record<AgentType, string> = {
  DATA_AGENT: "סוכן נתונים פנימיים",
  COMPLIANCE_AGENT: "סוכן ציות וסיכונים",
  EXTERNAL_DATA_AGENT: "סוכן נתונים חיצוניים",
};

/** Multi-agent chat over POST /api/ai/agent-chat (services/ai_orchestrator, TODO_SPEC.md
 * §2/§6/§7) — routes each message to the matching specialist agent (data/compliance/
 * external), keeps a `session_id` across turns for short-term memory, shows which agent
 * answered, and renders a human-in-the-loop Action Card when the Compliance Agent
 * proposes a Mitigation_Task. Supersedes the single-endpoint CopilotWidget as the
 * system-wide assistant (still mounted once in Layout, reachable from every screen);
 * CopilotWidget itself is left in place, just unmounted, in case a simpler pure-Q&A
 * widget is wanted again later. */
export default function AIAssistant() {
  const { open, setOpen, pendingPropertyContext, clearPendingPropertyContext } = useAIAssistant();
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, loading, open]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setMessage("");
    setTurns((prev) => [...prev, { role: "user", text: trimmed }]);
    setLoading(true);
    try {
      const result = await sendAgentChatMessage(trimmed, sessionId);
      setSessionId(result.session_id);
      setTurns((prev) => [...prev, { role: "agent", text: result.answer, agent: result.agent }]);
    } catch (err) {
      let text = "שגיאה בפנייה לשירות ה-AI. נסו שוב מאוחר יותר.";
      if (isAxiosError(err)) {
        if (err.response?.status === 503) {
          text = "שירות ה-AI אינו מוגדר כרגע (חסר מפתח API בצד השרת).";
        } else if (err.response?.status === 429) {
          text = "יותר מדי בקשות בזמן קצר — נסו שוב בעוד רגע.";
        } else if (err.response?.data?.detail) {
          text = String(err.response.data.detail);
        }
      }
      setTurns((prev) => [...prev, { role: "agent", text: "", error: text }]);
    } finally {
      setLoading(false);
    }
  };

  // Injected property context (TODO_SPEC.md §7): PropertyDetail's "נתח סיכונים
  // באמצעות AI" button opens the panel via useAIAssistant().openWithProperty — this
  // effect fires the compliance check for that exact property without the user
  // having to type/select it, and appends an Action Card if the property is
  // non-compliant, all under the same session so context carries into follow-up chat.
  useEffect(() => {
    if (!pendingPropertyContext) return;
    const { propertyId, propertyName } = pendingPropertyContext;
    clearPendingPropertyContext();
    setTurns((prev) => [
      ...prev,
      { role: "user", text: `נתח את מצב הסיכון והתאימות של הנכס "${propertyName}"` },
    ]);
    setLoading(true);
    (async () => {
      try {
        const [chatResult, proposalResult] = await Promise.all([
          sendAgentChatMessage(
            `נתח את מצב הסיכון והתאימות של הנכס "${propertyName}" (מזהה ${propertyId})`,
            sessionId
          ),
          proposeMitigationTask(propertyId, sessionId),
        ]);
        setSessionId(chatResult.session_id);
        setTurns((prev) => [
          ...prev,
          { role: "agent", text: chatResult.answer, agent: chatResult.agent },
          ...(proposalResult
            ? ([
                {
                  role: "agent" as const,
                  text: "",
                  agent: "COMPLIANCE_AGENT" as const,
                  actionCard: { actionId: proposalResult.action_id, proposal: proposalResult.proposal },
                },
              ] as AgentTurn[])
            : []),
        ]);
      } catch (err) {
        const text = isAxiosError(err) && err.response?.status === 503
          ? "שירות ה-AI אינו מוגדר כרגע (חסר מפתח API בצד השרת)."
          : "שגיאה בניתוח הנכס. נסו שוב מאוחר יותר.";
        setTurns((prev) => [...prev, { role: "agent", text: "", error: text }]);
      } finally {
        setLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, [pendingPropertyContext]);

  if (!open) {
    return (
      <Tooltip title="עוזר AI — סוכני נתונים, ציות ומאקרו" placement="left">
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
        width: { xs: "calc(100vw - 32px)", sm: 420 },
        height: 560,
        maxHeight: "75vh",
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
          עוזר AI — RMIS
        </Typography>
        {turns.length > 0 && (
          <Tooltip title="נקה שיחה">
            <IconButton
              size="small"
              onClick={() => {
                setTurns([]);
                setSessionId(null);
              }}
              sx={{ color: "inherit" }}
            >
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
              שוחחו עם מערך הסוכנים: נתונים פנימיים, ציות וסיכונים, ונתוני מאקרו חיצוניים — הניתוב
              נעשה אוטומטית לפי תוכן הפנייה.
            </Typography>
            <Stack spacing={0.75}>
              {SUGGESTED_QUESTIONS.map((sq) => (
                <Paper
                  key={sq}
                  variant="outlined"
                  onClick={() => send(sq)}
                  sx={{ p: 1, cursor: "pointer", fontSize: 13, "&:hover": { bgcolor: "grey.50" } }}
                >
                  {sq}
                </Paper>
              ))}
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            {turns.map((turn, i) =>
              turn.role === "user" ? (
                <Stack key={i} direction="row" spacing={1} justifyContent="flex-end">
                  <Paper
                    sx={{ px: 1.5, py: 1, bgcolor: "primary.main", color: "primary.contrastText", maxWidth: "85%" }}
                  >
                    <Typography variant="body2">{turn.text}</Typography>
                  </Paper>
                </Stack>
              ) : (
                <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
                  <Avatar sx={{ width: 24, height: 24, bgcolor: "grey.300" }}>
                    <SmartToyIcon sx={{ fontSize: 16 }} />
                  </Avatar>
                  <Stack spacing={0.5} sx={{ maxWidth: "85%" }}>
                    {turn.agent && !turn.actionCard && (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={AGENT_LABELS[turn.agent]}
                        sx={{ alignSelf: "flex-start", height: 20, fontSize: 11 }}
                      />
                    )}
                    {turn.error ? (
                      <Alert severity="warning" sx={{ py: 0 }}>
                        {turn.error}
                      </Alert>
                    ) : turn.actionCard ? (
                      <ActionCard actionId={turn.actionCard.actionId} proposal={turn.actionCard.proposal} />
                    ) : (
                      <Paper variant="outlined" sx={{ px: 1.5, py: 1, bgcolor: "grey.50" }}>
                        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                          <StreamedAnswer text={turn.text} />
                        </Typography>
                      </Paper>
                    )}
                  </Stack>
                </Stack>
              )
            )}
            {loading && (
              <Stack direction="row" spacing={1} alignItems="center">
                <Avatar sx={{ width: 24, height: 24, bgcolor: "grey.300" }}>
                  <SmartToyIcon sx={{ fontSize: 16 }} />
                </Avatar>
                <CircularProgress size={14} />
                <Typography variant="caption" color="text.secondary">
                  הסוכן חושב ומפעיל כלים...
                </Typography>
              </Stack>
            )}
          </Stack>
        )}
      </Box>

      <Stack direction="row" spacing={1} sx={{ p: 1.5, borderTop: "1px solid", borderColor: "divider" }}>
        <TextField
          size="small"
          fullWidth
          placeholder="שאלו את מערך הסוכנים..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(message);
            }
          }}
          disabled={loading}
        />
        <IconButton color="primary" onClick={() => send(message)} disabled={loading || !message.trim()}>
          <SendIcon />
        </IconButton>
      </Stack>
    </Paper>
  );
}
