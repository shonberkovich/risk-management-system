import AttachFileIcon from "@mui/icons-material/AttachFile";
import DeleteIcon from "@mui/icons-material/Delete";
import DescriptionIcon from "@mui/icons-material/Description";
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
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type MouseEvent, useEffect, useState } from "react";

import {
  fetchEmailTemplates,
  fetchUsers,
  sendEmail,
  uploadEmailAttachments,
  type EmailCreate,
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

export interface EmailComposeModalProps {
  open: boolean;
  onClose: () => void;
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

/** A message this modal successfully created stays "sent" even if the follow-up
 * attachment upload then fails — see handleSend's two-step design (Task 6). This
 * type tracks that so a retry after such a failure re-attempts only the upload,
 * never re-sends (and re-splits/re-notifies) the same message. */
type SendState =
  | { stage: "idle" }
  | { stage: "sending" }
  | { stage: "uploading"; emailId: number }
  | { stage: "error"; message: string; emailId: number | null };

export default function EmailComposeModal({
  open,
  onClose,
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
  const [sendState, setSendState] = useState<SendState>({ stage: "idle" });

  // Reset every field to the (possibly pre-filled) reply-mode defaults each time
  // the modal is opened — but not on every re-render while it's already open, so
  // a parent re-render mid-edit doesn't clobber what the user is typing.
  useEffect(() => {
    if (!open) return;
    setSubject(initialSubject ?? "");
    setBody(initialBody ?? "");
    setCc([]);
    setBcc([]);
    setPendingFiles([]);
    setIsDragActive(false);
    setSendState({ stage: "idle" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // initialTo is a list of user_ids; resolving it to full User objects (for the
  // Autocomplete's `value`) has to wait for the users list to be loaded, so this
  // runs separately from the reset effect above.
  useEffect(() => {
    if (!open) return;
    if (!initialTo || initialTo.length === 0) {
      setTo([]);
      return;
    }
    if (!users.data) return;
    setTo(users.data.filter((u) => initialTo.includes(u.user_id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, users.data]);

  const sending = sendState.stage === "sending" || sendState.stage === "uploading";
  const errorMessage = sendState.stage === "error" ? sendState.message : null;
  // Once a send has produced an email_id (either just now or on a prior failed
  // attempt), a retry must not re-POST /api/emails — see SendState's doc comment.
  const alreadyCreatedEmailId =
    sendState.stage === "uploading" ? sendState.emailId : sendState.stage === "error" ? sendState.emailId : null;

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
    setSendState({ stage: "idle" });
    setTemplateMenuAnchor(null);
    onClose();
  };

  const handleSend = async () => {
    let emailId = alreadyCreatedEmailId;
    try {
      if (emailId === null) {
        setSendState({ stage: "sending" });
        const payload: EmailCreate = {
          to: to.map((u) => u.user_id),
          cc: cc.length > 0 ? cc.map((u) => u.user_id) : undefined,
          bcc: bcc.length > 0 ? bcc.map((u) => u.user_id) : undefined,
          subject: subject.trim(),
          body_html: plainTextToHtml(body),
          in_reply_to: inReplyTo ?? undefined,
        };
        const email = await sendEmail(payload);
        emailId = email.email_id;
      }
      if (pendingFiles.length > 0) {
        setSendState({ stage: "uploading", emailId });
        await uploadEmailAttachments(emailId, pendingFiles);
      }
      // Refresh every ["emails", ...] query (folder lists + sidebar unread counts)
      // so the sender's own SENT-folder view updates without a manual refresh —
      // same broad-invalidation convention Emails.tsx's markReadMutation already uses.
      queryClient.invalidateQueries({ queryKey: ["emails"] });
      resetAndClose();
    } catch {
      // Don't silently lose a drafted message + staged files on a network error:
      // keep the modal open, keep every field (including pendingFiles) as-is, and
      // surface a message that's honest about what already succeeded.
      setSendState({
        stage: "error",
        emailId,
        message:
          emailId !== null
            ? "המייל נשלח בהצלחה, אך העלאת הקבצים המצורפים נכשלה. ניתן ללחוץ שוב על 'שליחה' כדי לנסות להעלות את הקבצים בלבד."
            : "שליחת המייל נכשלה. בדקו את החיבור ונסו שוב.",
      });
    }
  };

  const canSend = to.length > 0 && subject.trim() !== "" && body.trim() !== "" && !sending;

  const sendButtonLabel =
    sendState.stage === "sending" ? "שולח..." : sendState.stage === "uploading" ? "מעלה קבצים..." : "שליחה";

  return (
    <Dialog open={open} onClose={sending ? undefined : resetAndClose} maxWidth="sm" fullWidth>
      <DialogTitle>{inReplyTo ? "תגובה" : "מייל חדש"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Autocomplete
            multiple
            disabled={sending}
            options={users.data ?? []}
            value={to}
            onChange={(_, value) => setTo(value)}
            getOptionLabel={(u) => u.full_name}
            isOptionEqualToValue={(a, b) => a.user_id === b.user_id}
            renderInput={(params) => <TextField {...params} label="אל" placeholder="בחירת נמענים" />}
          />
          <Autocomplete
            multiple
            disabled={sending}
            options={users.data ?? []}
            value={cc}
            onChange={(_, value) => setCc(value)}
            getOptionLabel={(u) => u.full_name}
            isOptionEqualToValue={(a, b) => a.user_id === b.user_id}
            renderInput={(params) => <TextField {...params} label="עותק (CC)" placeholder="אופציונלי" />}
          />
          <Autocomplete
            multiple
            disabled={sending}
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
              disabled={sending}
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
            disabled={sending}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />

          <TextField
            label="תוכן ההודעה"
            fullWidth
            multiline
            minRows={6}
            disabled={sending}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />

          <Box
            data-testid="compose-dropzone"
            onDragOver={(e) => {
              e.preventDefault();
              if (!sending) setIsDragActive(true);
            }}
            onDragLeave={() => setIsDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragActive(false);
              if (!sending) addFiles(e.dataTransfer.files);
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
            <Button component="label" size="small" variant="outlined" startIcon={<UploadFileIcon />} disabled={sending}>
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
                    disabled={sending}
                    aria-label={`הסרת ${file.name}`}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
          )}

          {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={resetAndClose} disabled={sending}>
          ביטול
        </Button>
        <Button
          variant="contained"
          disabled={!canSend}
          onClick={handleSend}
          startIcon={sending ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {sendButtonLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
