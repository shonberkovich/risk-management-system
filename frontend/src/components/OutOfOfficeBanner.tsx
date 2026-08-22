import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Alert from "@mui/material/Alert";

import type { CurrentUser } from "../api/client";

/** TODO_SPEC.md "משימה 18" step 5 — is the *current* user's own out-of-office
 * auto-responder active right now: enabled AND today falls within the inclusive
 * [auto_reply_start, auto_reply_end] window. Mirrors the backend's own range check
 * (services/email.py's `_maybe_send_auto_reply`) — a missing start/end means
 * "never active", never "always active". Exported (not just used internally) so
 * this exact condition can be unit-tested directly, the same way the component
 * that reads it is. `auto_reply_start`/`auto_reply_end` are "YYYY-MM-DD" strings
 * (see api/client.ts's CurrentUser docstring) — plain lexicographic comparison
 * against today's own "YYYY-MM-DD" is correct for that format, no Date parsing
 * needed. */
export function isAutoResponderActive(
  user: Pick<CurrentUser, "auto_reply_enabled" | "auto_reply_start" | "auto_reply_end"> | null | undefined,
): boolean {
  if (!user?.auto_reply_enabled || !user.auto_reply_start || !user.auto_reply_end) return false;
  const today = new Date().toISOString().slice(0, 10);
  return user.auto_reply_start <= today && today <= user.auto_reply_end;
}

/** Small yellow warning banner shown at the top of the email UI (Emails.tsx) while
 * the signed-in user's own auto-responder is active — TODO_SPEC.md "משימה 18" step
 * 5's literal wording, "מענה אוטומטי מופעל כעת". Matches AlertsBanner.tsx's existing
 * severity="warning"/outlined banner styling convention rather than inventing new
 * banner styling; kept as its own small component (rather than folded into
 * AlertsBanner itself) since it reads a different data source — the signed-in
 * user's own settings, not a GET /api/analytics/alerts-style feed — and is scoped
 * to the mail UI specifically. Renders nothing when the auto-responder isn't
 * currently active, same "silent when there's nothing to show" contract
 * AlertsBanner uses. */
export default function OutOfOfficeBanner({ user }: { user: CurrentUser | null }) {
  if (!isAutoResponderActive(user)) return null;

  return (
    <Alert severity="warning" icon={<WarningAmberIcon />} variant="outlined" data-testid="out-of-office-banner">
      מענה אוטומטי מופעל כעת
    </Alert>
  );
}
