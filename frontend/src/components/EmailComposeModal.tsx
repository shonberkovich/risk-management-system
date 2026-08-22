import AttachFileIcon from "@mui/icons-material/AttachFile";
import DeleteIcon from "@mui/icons-material/Delete";
import DescriptionIcon from "@mui/icons-material/Description";
import ScheduleIcon from "@mui/icons-material/Schedule";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Popover from "@mui/material/Popover";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type MouseEvent, useEffect, useRef, useState } from "react";

import {
  fetchEmailTemplates,
  fetchUsers,
  scheduleEmail,
  sendEmail,
  uploadEmailAttachments,
  type EmailCreate,
  type EmailScheduleCreate,
  type EmailTemplate,
  type User,
} from "../api/client";
import { applyEmailTemplate, type EmailTemplateVariables } from "../utils/emailTemplates";

/** TODO_SPEC.md "משימה 8" — Compose modal for the internal email system.
 *
 * Rich text: the spec allows either a real editor (react-quill etc.) if one is
 * already a dependency, or an honest plain-text fallback if not. Nothing of the
 * sort is in frontend/package.json (checked before writing this file — MUI is
 * the only UI kit here, and it ships no editor of its own), and this task's
 * brief explicitly says not to add a new heavy dependency just for this modal.
 * So the body field is a plain multiline TextField; on send its text is
 * HTML-escaped and wrapped as `<p>...</p>` (newlines become `<br />`) before
 * being sent as `body_html` — never raw/unescaped, so it can't itself introduce
 * markup the backend would need to sanitize. Real HTML authoring (bold/italic/
 * lists) is left for a future pass, matching Task 10's note that body_html
 * rendering is still plain-text-only on the reading side (Emails.tsx's
 * stripHtml) until server-side sanitization lands.
 *
 * TODO_SPEC.md "משימה 13" — Undo-send: clicking "שליחה" no longer calls the API
 * right away. It closes the dialog immediately (so the action feels instant)
 * and holds the actual `sendEmail` + attachment upload behind a plain
 * `setTimeout` for `UNDO_WINDOW_SECONDS`, while a Snackbar shows a live
 * countdown and a "בטל שליחה" button. Clicking undo within the window
 * `clearTimeout`s the pending send (the API is never called) and reopens the
 * dialog with every field exactly as the user left it — see `restoringDraftRef`
 * below for how that survives the dialog's own "reset fields on open" effect.
 * Letting the window elapse fires the real send.
 *
 * This intentionally does NOT reuse Layout.tsx's global new-email Snackbar
 * (TODO_SPEC.md "משימה 9"): that one is a single fire-and-forget toast with a
 * fixed `autoHideDuration` and no action button, driven by an unrelated SSE
 * event stream. This one needs a live per-second countdown, an undo action,
 * and to stay mounted (and keep ticking) after the compose Dialog itself has
 * closed — composing it into the global toast would mean either giving that
 * toast an action-button/countdown mode it doesn't otherwise need, or routing
 * undo-send's timer state up into Layout, both a bigger and muddier change
 * than a small local Snackbar owned by the component that actually holds the
 * pending send. Undo-send has no backend involvement at all — it never leaves
 * the browser until the window elapses.
 *
 * TODO_SPEC.md "משימה 13" — Scheduled send: "שלח במועד אחר" opens a small
 * popover with a native `<input type="datetime-local">` (no `@mui/x-date-
 * pickers` dependency in package.json, and the task brief explicitly allows
 * this fallback rather than adding one just for this) and calls
 * `POST /api/emails/schedule` instead of the normal send — no undo-send hold
 * on top of it, since scheduling is itself already a deferred send.
 */

/** Escapes the five HTML-significant characters, then turns the plain-text body
 * into a single paragraph with <br /> line breaks — mirrors how a plain textarea's
 * value should become "safe" body_html without pulling in a sanitizer/editor lib. */
function plainTextToHtml(text: string): string {
  const escaped = text
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return `<p>${escaped.split("\n").join("<br />")}</p>`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** How long a normal send waits, undo-able, before actually hitting the API. */
const UNDO_WINDOW_SECONDS = 10;

export interface EmailComposeModalProps {
  open: boolean;
  onClose: () => void;
  /** TODO_SPEC.md "משימה 13" — called when the user clicks "בטל שליחה" within the
   * undo window: tells the parent to show the dialog again (`open` is a
   * controlled prop this component doesn't own). Every drafted field is still
   * intact in this component's own state at that point (see module docstring) —
   * a caller that omits this prop still gets a correctly-cancelled send (the API
   * is never called), it just won't visually reopen the dialog on its own. */
  onReopen?: () => void;
  /** Pre-fill hooks for a future "Reply" entry point (see module docstring below) —
   * the modal itself supports opening pre-filled even though no caller wires a Reply
   * button yet. `initialTo` are user_ids (resolved to full User objects once the users
   * list loads). `initialBody` is plain text, same as what the body TextField holds. */
  initialTo?: number[];
  initialSubject?: string;
  initialBody?: string;
  inReplyTo?: number | null;
  /** TODO_SPEC.md "משימה 12" step 4 — context to fill {{claim_number}}/
   * {{client_name}}/... placeholders with when a template is picked via the
   * "השתמש בתבנית" button below, e.g. when Compose was opened from a Claim's
   * or Incident's detail page. A placeholder with no matching (or empty)
   * value here is left visible/editable in the loaded text rather than
   * silently dropped — see utils/emailTemplates.ts. */
  templateContext?: EmailTemplateVariables;
}

/** A message this modal successfully scheduled/created stays that way even if
 * the follow-up attachment upload then fails — see handleScheduleConfirm's
 * two-step design (Task 6), mirrored here for the schedule flow. Tracks the
 * *schedule* action only: a normal send no longer has any in-dialog loading
 * state at all (TODO_SPEC.md "משימה 13" — it's staged and the dialog closes
 * instantly, see module docstring), so this type/`scheduleState` exist purely
 * for "שלח במועד אחר", not for the plain "שליחה" button. */
type ScheduleState =
  | { stage: "idle" }
  | { stage: "scheduling" }
  | { stage: "uploading"; emailId: number }
  | { stage: "error"; message: string; emailId: number | null };

/** Formats a `Date` as the value a native `<input type="datetime-local">`
 * expects (`YYYY-MM-DDTHH:mm`, local time, no timezone) — used only to seed a
 * sensible default (a few minutes from now) in the picker. */
function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function EmailComposeModal({
  open,
  onClose,
  onReopen,
  initialTo,
  initialSubject,
  initialBody,
  inReplyTo,
  templateContext,
}: EmailComposeModalProps) {
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: fetchUsers, enabled: open });
  // Same "fetch once the modal is open" convention as `users` above, so the
  // picker's list is already loaded (no extra spinner) the moment the
  // "השתמש בתבנית" button is clicked.
  const templates = useQuery({ queryKey: ["email-templates"], queryFn: fetchEmailTemplates, enabled: open });
  const [templateMenuAnchor, setTemplateMenuAnchor] = useState<HTMLElement | null>(null);

  const [to, setTo] = useState<User[]>([]);
  const [cc, setCc] = useState<User[]>([]);
  const [bcc, setBcc] = useState<User[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);

  // --- Undo-send (TODO_SPEC.md "משימה 13") ---
  const [secondsLeft, setSecondsLeft] = useState(0);
  const pendingSendRef = useRef<{ payload: EmailCreate; files: File[] } | null>(null);
  const sendTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set right before calling onReopen() from handleUndo, and consumed (cleared)
  // by the "reset fields on open" effect below — lets that effect tell "the user
  // just clicked undo, keep my drafted fields" apart from "this is a fresh open,
  // reset to initial*/blank" without adding an extra prop the parent would have
  // to thread through just for this.
  const restoringDraftRef = useRef(false);

  // --- Scheduled send (TODO_SPEC.md "משימה 13") ---
  const [scheduleAnchor, setScheduleAnchor] = useState<HTMLElement | null>(null);
  const [scheduledForValue, setScheduledForValue] = useState("");
  const [scheduleState, setScheduleState] = useState<ScheduleState>({ stage: "idle" });
  const scheduling = scheduleState.stage === "scheduling" || scheduleState.stage === "uploading";
  const scheduleErrorMessage = scheduleState.stage === "error" ? scheduleState.message : null;
  const alreadyScheduledEmailId =
    scheduleState.stage === "uploading" ? scheduleState.emailId : scheduleState.stage === "error" ? scheduleState.emailId : null;

  // Reset every field to the (possibly pre-filled) reply-mode defaults each time
  // the modal is opened — but not on every re-render while it's already open, so
  // a parent re-render mid-edit doesn't clobber what the user is typing. Skipped
  // entirely when this open was triggered by clicking "בטל שליחה" (see
  // restoringDraftRef above) so the just-cancelled draft survives the reopen.
  useEffect(() => {
    if (!open) return;
    // Consumed (cleared) by the *next* effect below, not this one — both effects
    // run for the same "open flipped to true" render, in declaration order, and
    // both need to see the flag before either resets it. See restoringDraftRef's
    // own doc comment.
    if (restoringDraftRef.current) return;
    setSubject(initialSubject ?? "");
    setBody(initialBody ?? "");
    setCc([]);
    setBcc([]);
    setPendingFiles([]);
    setIsDragActive(false);
    setScheduleState({ stage: "idle" });
    setScheduleAnchor(null);
    setScheduledForValue("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // initialTo is a list of user_ids; resolving it to full User objects (for the
  // Autocomplete's `value`) has to wait for the users list to be loaded, so this
  // runs separately from the reset effect above. Also skipped (and this is what
  // finally clears restoringDraftRef) on a "בטל שליחה"-triggered reopen — without
  // this, an undo-reopened compose with no `initialTo` prop would call `setTo([])`
  // here and silently wipe the very recipients the user just chose.
  useEffect(() => {
    if (!open) return;
    if (restoringDraftRef.current) {
      restoringDraftRef.current = false;
      return;
    }
    if (!initialTo || initialTo.length === 0) {
      setTo([]);
      return;
    }
    if (!users.data) return;
    setTo(users.data.filter((u) => initialTo.includes(u.user_id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, users.data]);

  const addFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setPendingFiles((prev) => [...prev, ...Array.from(fileList)]);
  };

  const openTemplateMenu = (event: MouseEvent<HTMLElement>) => setTemplateMenuAnchor(event.currentTarget);
  const closeTemplateMenu = () => setTemplateMenuAnchor(null);

  // TODO_SPEC.md "משימה 12" step 4/5: fills subject/body from the chosen
  // template (variables substituted from `templateContext`, unresolved
  // `{{...}}` placeholders left visible) — plain state writes into the same
  // TextFields the user already types into, so nothing about "keep editing
  // after loading a template" needs special-casing below.
  const selectTemplate = (template: EmailTemplate) => {
    const rendered = applyEmailTemplate(template, templateContext ?? {});
    setSubject(rendered.subject);
    setBody(rendered.body);
    closeTemplateMenu();
  };

  const removeFileAt = (idx: number) => setPendingFiles((prev) => prev.filter((_, i) => i !== idx));

  const resetAndClose = () => {
    setTo([]);
    setCc([]);
    setBcc([]);
    setSubject("");
    setBody("");
    setPendingFiles([]);
    setScheduleState({ stage: "idle" });
    setTemplateMenuAnchor(null);
    setScheduleAnchor(null);
    onClose();
  };

  const clearPendingSendTimers = () => {
    if (sendTimeoutRef.current !== null) {
      clearTimeout(sendTimeoutRef.current);
      sendTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current !== null) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  };

  // Fires for real once the undo window has elapsed with no undo click. The
  // compose dialog is long closed by this point (see handleStageSend) — there's
  // no form left to show an inline error/retry affordance in, so a failure here
  // is swallowed after invalidating queries stays a no-op; a production build
  // would surface this via e.g. a follow-up toast, out of scope for this task.
  const performRealSend = async (payload: EmailCreate, files: File[]) => {
    pendingSendRef.current = null;
    try {
      const email = await sendEmail(payload);
      if (files.length > 0) {
        await uploadEmailAttachments(email.email_id, files);
      }
      queryClient.invalidateQueries({ queryKey: ["emails"] });
    } catch {
      // See doc comment above — nothing left to surface this to.
    } finally {
      setSecondsLeft(0);
    }
  };

  // TODO_SPEC.md "משימה 13" step 1: stages the send behind a 10s undo window
  // instead of calling the API immediately, then closes the dialog right away.
  const handleStageSend = () => {
    const payload: EmailCreate = {
      to: to.map((u) => u.user_id),
      cc: cc.length > 0 ? cc.map((u) => u.user_id) : undefined,
      bcc: bcc.length > 0 ? bcc.map((u) => u.user_id) : undefined,
      subject: subject.trim(),
      body_html: plainTextToHtml(body),
      in_reply_to: inReplyTo ?? undefined,
    };
    const files = pendingFiles;

    clearPendingSendTimers();
    pendingSendRef.current = { payload, files };
    setSecondsLeft(UNDO_WINDOW_SECONDS);

    countdownIntervalRef.current = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    sendTimeoutRef.current = setTimeout(() => {
      clearPendingSendTimers();
      void performRealSend(payload, files);
    }, UNDO_WINDOW_SECONDS * 1000);

    // Close immediately (the whole point of undo-send: the action feels
    // instant) — fields are left exactly as-is in this component's own state,
    // not cleared, so a click on "בטל שליחה" can restore them verbatim.
    onClose();
  };

  const handleUndoSend = () => {
    clearPendingSendTimers();
    pendingSendRef.current = null;
    setSecondsLeft(0);
    restoringDraftRef.current = true;
    onReopen?.();
  };

  const handleScheduleConfirm = async () => {
    if (!scheduledForValue) return;
    const scheduledDate = new Date(scheduledForValue);
    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
      setScheduleState({ stage: "error", message: "יש לבחור מועד עתידי.", emailId: null });
      return;
    }

    let emailId = alreadyScheduledEmailId;
    try {
      if (emailId === null) {
        setScheduleState({ stage: "scheduling" });
        const payload: EmailScheduleCreate = {
          to: to.map((u) => u.user_id),
          cc: cc.length > 0 ? cc.map((u) => u.user_id) : undefined,
          bcc: bcc.length > 0 ? bcc.map((u) => u.user_id) : undefined,
          subject: subject.trim(),
          body_html: plainTextToHtml(body),
          in_reply_to: inReplyTo ?? undefined,
          scheduled_for: scheduledDate.toISOString(),
        };
        const email = await scheduleEmail(payload);
        emailId = email.email_id;
      }
      if (pendingFiles.length > 0) {
        setScheduleState({ stage: "uploading", emailId });
        await uploadEmailAttachments(emailId, pendingFiles);
      }
      queryClient.invalidateQueries({ queryKey: ["scheduled-emails"] });
      resetAndClose();
    } catch {
      setScheduleState({
        stage: "error",
        emailId,
        message:
          emailId !== null
            ? "המייל תוזמן בהצלחה, אך העלאת הקבצים המצורפים נכשלה. ניתן ללחוץ שוב על 'תזמן שליחה' כדי לנסות להעלות את הקבצים בלבד."
            : "תזמון המייל נכשל. בדקו את המועד שנבחר ואת החיבור ונסו שוב.",
      });
    }
  };

  const openSchedulePopover = (event: MouseEvent<HTMLElement>) => {
    if (!scheduledForValue) {
      setScheduledForValue(toDatetimeLocalValue(new Date(Date.now() + 15 * 60 * 1000)));
    }
    setScheduleAnchor(event.currentTarget);
  };

  const canSend = to.length > 0 && subject.trim() !== "" && body.trim() !== "" && !scheduling;

  const scheduleButtonLabel =
    scheduleState.stage === "scheduling" ? "מתזמן..." : scheduleState.stage === "uploading" ? "מעלה קבצים..." : "תזמן שליחה";

  return (
    <>
      <Dialog open={open} onClose={scheduling ? undefined : resetAndClose} maxWidth="sm" fullWidth>
        <DialogTitle>{inReplyTo ? "תגובה" : "מייל חדש"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Autocomplete
              multiple
              disabled={scheduling}
              options={users.data ?? []}
              value={to}
              onChange={(_, value) => setTo(value)}
              getOptionLabel={(u) => u.full_name}
              isOptionEqualToValue={(a, b) => a.user_id === b.user_id}
              renderInput={(params) => <TextField {...params} label="אל" placeholder="בחירת נמענים" />}
            />
            <Autocomplete
              multiple
              disabled={scheduling}
              options={users.data ?? []}
              value={cc}
              onChange={(_, value) => setCc(value)}
              getOptionLabel={(u) => u.full_name}
              isOptionEqualToValue={(a, b) => a.user_id === b.user_id}
              renderInput={(params) => <TextField {...params} label="עותק (CC)" placeholder="אופציונלי" />}
            />
            <Autocomplete
              multiple
              disabled={scheduling}
              options={users.data ?? []}
              value={bcc}
              onChange={(_, value) => setBcc(value)}
              getOptionLabel={(u) => u.full_name}
              isOptionEqualToValue={(a, b) => a.user_id === b.user_id}
              renderInput={(params) => <TextField {...params} label="עותק מוסתר (BCC)" placeholder="אופציונלי" />}
            />

            <Box>
              <Button
                size="small"
                variant="outlined"
                startIcon={<DescriptionIcon fontSize="small" />}
                disabled={scheduling}
                onClick={openTemplateMenu}
              >
                השתמש בתבנית
              </Button>
              <Menu anchorEl={templateMenuAnchor} open={templateMenuAnchor !== null} onClose={closeTemplateMenu}>
                {templates.isLoading && <MenuItem disabled>טוען תבניות...</MenuItem>}
                {!templates.isLoading && (templates.data ?? []).length === 0 && (
                  <MenuItem disabled>אין תבניות זמינות</MenuItem>
                )}
                {(templates.data ?? []).map((template) => (
                  <MenuItem key={template.id} onClick={() => selectTemplate(template)}>
                    <ListItemText primary={template.name} secondary={template.subject_template} />
                  </MenuItem>
                ))}
              </Menu>
            </Box>

            <TextField
              label="נושא"
              fullWidth
              disabled={scheduling}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />

            <TextField
              label="תוכן ההודעה"
              fullWidth
              multiline
              minRows={6}
              disabled={scheduling}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />

            <Box
              data-testid="compose-dropzone"
              onDragOver={(e) => {
                e.preventDefault();
                if (!scheduling) setIsDragActive(true);
              }}
              onDragLeave={() => setIsDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragActive(false);
                if (!scheduling) addFiles(e.dataTransfer.files);
              }}
              sx={{
                border: "2px dashed",
                borderColor: isDragActive ? "primary.main" : "divider",
                borderRadius: 1,
                p: 2,
                textAlign: "center",
                bgcolor: isDragActive ? "action.hover" : "transparent",
                transition: "background-color 0.15s, border-color 0.15s",
              }}
            >
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                גררו קבצים לכאן לצירוף, או
              </Typography>
              {/* Drag-and-drop alone is a bad primary UX (not discoverable, unusable via
                  keyboard) — a normal file-picker button stays the fallback/primary path. */}
              <Button component="label" size="small" variant="outlined" startIcon={<UploadFileIcon />} disabled={scheduling}>
                בחירת קבצים
                <input
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </Button>
            </Box>

            {pendingFiles.length > 0 && (
              <Stack spacing={0.5} data-testid="compose-pending-attachments">
                {pendingFiles.map((file, idx) => (
                  <Stack
                    key={`${file.name}-${idx}`}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <Chip
                      icon={<AttachFileIcon fontSize="small" />}
                      label={`${file.name} (${formatFileSize(file.size)})`}
                      size="small"
                      sx={{ maxWidth: "85%" }}
                    />
                    <IconButton
                      size="small"
                      onClick={() => removeFileAt(idx)}
                      disabled={scheduling}
                      aria-label={`הסרת ${file.name}`}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
            )}

            {scheduleErrorMessage && <Alert severity="error">{scheduleErrorMessage}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={resetAndClose} disabled={scheduling}>
            ביטול
          </Button>
          <Button
            size="small"
            startIcon={<ScheduleIcon fontSize="small" />}
            disabled={!canSend}
            onClick={openSchedulePopover}
          >
            שלח במועד אחר
          </Button>
          <Button variant="contained" disabled={!canSend} onClick={handleStageSend}>
            שליחה
          </Button>
        </DialogActions>
      </Dialog>

      <Popover
        open={scheduleAnchor !== null}
        anchorEl={scheduleAnchor}
        onClose={() => !scheduling && setScheduleAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        transformOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Stack spacing={1.5} sx={{ p: 2, width: 280 }}>
          <Typography variant="subtitle2">תזמון שליחת המייל</Typography>
          <TextField
            type="datetime-local"
            label="מועד שליחה"
            size="small"
            fullWidth
            disabled={scheduling}
            value={scheduledForValue}
            onChange={(e) => setScheduledForValue(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button size="small" onClick={() => setScheduleAnchor(null)} disabled={scheduling}>
              ביטול
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={handleScheduleConfirm}
              disabled={scheduling || !scheduledForValue}
              startIcon={scheduling ? <CircularProgress size={14} color="inherit" /> : undefined}
            >
              {scheduleButtonLabel}
            </Button>
          </Stack>
        </Stack>
      </Popover>

      {/* TODO_SPEC.md "משימה 13" step 1 — undo-send countdown. A local Snackbar
          (see module docstring for why this isn't Layout.tsx's global toast):
          stays open independently of the Dialog above, which is already closed
          by the time this is visible. */}
      <Snackbar open={secondsLeft > 0} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert
          severity="info"
          variant="filled"
          data-testid="undo-send-snackbar"
          action={
            <Button color="inherit" size="small" onClick={handleUndoSend} data-testid="undo-send-button">
              בטל שליחה
            </Button>
          }
        >
          המייל יישלח בעוד {secondsLeft} שניות...
        </Alert>
      </Snackbar>
    </>
  );
}
