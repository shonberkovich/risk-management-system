import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";

import type { SpeechDictation } from "../hooks/useSpeechDictation";
import { ease } from "../ui/tokens";
import { useTokens } from "../ui/useTokens";

const BAR_DELAYS = [0, 0.18, 0.36, 0.12, 0.3];

/** The big tap-to-talk mic for voice dictation, plus a live status line. Renders
 * nothing on a browser without speech recognition, so the typed flow is unchanged. */
export default function VoiceDictationButton({
  dictation,
  onToggle,
  busy = false,
  busyLabel,
  notice,
}: {
  dictation: SpeechDictation;
  onToggle: () => void;
  /** Work the dictation kicked off is still running (e.g. the AI classification). */
  busy?: boolean;
  busyLabel?: string;
  /** An informational line to show while idle (e.g. why classification didn't run). */
  notice?: string | null;
}) {
  const t = useTokens();
  if (!dictation.supported) return null;

  const { listening, blockedReason, error } = dictation;
  const glow = t.neon.magenta;
  let title = "דיווח קולי";
  let hint: string = "הקישו על המיקרופון ותארו בעברית מה קרה — סוג הנזק והחומרה ימולאו אוטומטית.";
  let hintColor = "text.secondary";
  if (listening) {
    title = "מקשיב… דברו עכשיו";
    hint = "המילים מופיעות בתיאור. הקישו שוב לסיום, או פשוט הפסיקו לדבר.";
  } else if (busy) {
    title = busyLabel ?? "מעבד…";
    hint = "ממלא את סוג הנזק, החומרה והערכת הנזק.";
  } else if (blockedReason) {
    title = "דיווח קולי לא זמין";
    hint = blockedReason;
    hintColor = "warning.main";
  } else if (error) {
    hint = error;
    hintColor = "warning.main";
  } else if (notice) {
    hint = notice;
    hintColor = "info.main";
  }

  return (
    <Stack
      direction="row"
      spacing={2}
      alignItems="center"
      sx={{
        p: 1.5,
        borderRadius: 4,
        border: 1,
        borderColor: listening ? alpha(glow, 0.45) : "divider",
        bgcolor: listening ? alpha(glow, 0.07) : "transparent",
        transition: `background-color 0.4s ${ease.out}, border-color 0.4s ${ease.out}`,
      }}
    >
      <Tooltip describeChild title={blockedReason ?? (listening ? "הקישו לסיום" : "דיווח קולי בעברית")}>
        {/* span: a disabled button fires no events, so the tooltip needs a wrapper. */}
        <Box component="span" sx={{ display: "inline-flex", flexShrink: 0 }}>
          <IconButton
            onClick={onToggle}
            disabled={!!blockedReason || busy}
            aria-label={listening ? "עצירת הדיווח הקולי" : "התחלת דיווח קולי"}
            sx={{
              "--mic-glow": alpha(glow, 0.55),
              width: 64,
              height: 64,
              color: listening ? "common.white" : t.neon.violet,
              background: listening ? t.gradients.plasma : alpha(t.neon.violet, 0.1),
              border: `1px solid ${alpha(listening ? glow : t.neon.violet, 0.5)}`,
              animation: listening ? "rmis-mic-breathe 1.6s ease-in-out infinite" : "none",
              "&:hover": listening ? { background: t.gradients.plasma } : {},
              "&::before, &::after": listening
                ? {
                    content: '""',
                    position: "absolute",
                    inset: -1,
                    borderRadius: "50%",
                    border: `2px solid ${glow}`,
                    animation: `rmis-mic-ring 1.8s ${ease.out} infinite`,
                    pointerEvents: "none",
                  }
                : {},
              "&::after": listening ? { animationDelay: "0.9s" } : {},
              "&.Mui-disabled": { color: "text.disabled", background: "transparent", borderColor: "divider" },
            }}
          >
            {blockedReason ? <MicOffIcon fontSize="large" /> : <MicIcon fontSize="large" />}
          </IconButton>
        </Box>
      </Tooltip>

      <Box role="status" aria-live="polite" sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          {busy && !listening && <CircularProgress size={14} />}
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: listening ? glow : "text.primary" }}>
            {title}
          </Typography>
        </Stack>
        <Typography variant="body2" sx={{ color: hintColor }}>
          {hint}
        </Typography>
      </Box>

      {listening && (
        <Stack direction="row" spacing={0.5} alignItems="center" aria-hidden sx={{ height: 32, flexShrink: 0 }}>
          {BAR_DELAYS.map((delay, i) => (
            <Box
              key={i}
              sx={{
                width: 4,
                height: "100%",
                borderRadius: 2,
                background: t.gradients.plasma,
                transformOrigin: "center",
                animation: `rmis-mic-bar 0.9s ease-in-out ${delay}s infinite`,
              }}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
