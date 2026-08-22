import AttachFileIcon from "@mui/icons-material/AttachFile";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import EditIcon from "@mui/icons-material/Edit";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ReplyIcon from "@mui/icons-material/Reply";
import ScheduleIcon from "@mui/icons-material/Schedule";
import SearchIcon from "@mui/icons-material/Search";
import Alert from "@mui/material/Alert";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { useEffect, useState } from "react";
import type { MouseEvent } from "react";

import {
  addLabelToEmail,
  fetchEmailAttachmentSignedUrl,
  fetchEmailThread,
  fetchEmails,
  fetchLabels,
  fetchScheduledEmails,
  markEmailRead,
  removeLabelFromEmail,
  summarizeEmailThread,
  suggestEmailReply,
  type Email,
  type EmailFolder,
  type EmailListItem,
} from "../api/client";
import EmailComposeModal from "../components/EmailComposeModal";
import EmailEntityLinkControl from "../components/EmailEntityLinkControl";
import EmailSidebar from "../components/EmailSidebar";
import ScheduledEmailsDialog from "../components/ScheduledEmailsDialog";
import { formatDateTime } from "../format";

/** TODO_SPEC.md "משימה 15" — friendly copy for the AI endpoints' documented
 * 503 ("AI features are not configured", CLAUDE.md's graceful-degradation
 * pattern), mirroring CopilotWidget.tsx's own askQuestion error handling so
 * every AI-backed surface in this app shows the same message for the same
 * condition rather than each inventing its own wording. */
function aiErrorMessage(err: unknown): string {
  if (isAxiosError(err) && err.response?.status === 503) {
    return "שירות ה-AI אינו מוגדר כרגע (חסר מפתח API בצד השרת).";
  }
  return "שגיאה בפנייה לשירות ה-AI. נסו שוב מאוחר יותר.";
}

/** Pre-fill payload for opening EmailComposeModal in reply mode (Task 8's
 * `initialTo`/`initialSubject`/`initialBody`/`inReplyTo` props) — built by
 * EmailAiThreadActions.suggest-reply below, but shaped generically enough
 * that a future non-AI "השב" button could produce the same shape too. */
interface ReplyDraft {
  to: number[];
  subject: string;
  body: string;
  inReplyTo: number;
}

const FOLDER_LABELS: Record<EmailFolder, string> = {
  INBOX: "דואר נכנס",
  SENT: "נשלח",
  ARCHIVE: "ארכיון",
  TRASH: "אשפה",
  SPAM: "דואר זבל",
};

/** Renders body_html as real HTML via dangerouslySetInnerHTML (Task 10 step 2
 * replaces Task 7's plain-text-only stopgap, now that the backend sanitizes
 * body_html server-side on both the write path and the read path — see
 * backend/app/services/email.py's `sanitize_body_html` docstring and
 * routers/emails.py's `_to_email_out`). This is *not* "trust the wire because the
 * backend said so" in general — it's specifically safe here because `/api/emails`
 * is this same backend's own endpoint, there is no third-party or user-supplied
 * origin in the loop, and every response from it has already been run through
 * bleach.clean() with a small safe-tag allowlist (script/style/iframe/event
 * handlers/javascript: hrefs all stripped) before this component ever sees it. A
 * `dangerouslySetInnerHTML` fed exclusively by that sanitized output is an
 * accepted, intentional use of the API — not a blanket trust of arbitrary HTML. */
function EmailBody({ html }: { html: string }) {
  return <Box sx={{ "& p": { m: 0, mb: 1 }, "& p:last-child": { mb: 0 } }} dangerouslySetInnerHTML={{ __html: html }} />;
}

function AttachmentChip({ attachmentId, fileName }: { attachmentId: number; fileName: string }) {
  const signed = useQuery({
    queryKey: ["email-attachment-signed-url", attachmentId],
    queryFn: () => fetchEmailAttachmentSignedUrl(attachmentId),
  });
  return (
    <Chip
      icon={<AttachFileIcon fontSize="small" />}
      label={fileName}
      component={signed.data ? "a" : "div"}
      href={signed.data?.download_url}
      target="_blank"
      rel="noopener"
      clickable={!!signed.data}
      size="small"
    />
  );
}

function EmailMessageCard({ message }: { message: Email }) {
  const toNames = message.recipients.filter((r) => r.recipient_type === "TO").map((r) => r.user.full_name);
  const ccNames = message.recipients.filter((r) => r.recipient_type === "CC").map((r) => r.user.full_name);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={0.5} sx={{ mb: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {message.subject}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            מאת: {message.sender.full_name} · {formatDateTime(message.created_at)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            אל: {toNames.length > 0 ? toNames.join(", ") : "—"}
            {ccNames.length > 0 && <> · עותק: {ccNames.join(", ")}</>}
          </Typography>
          {message.labels.length > 0 && (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
              {message.labels.map((label) => (
                <Chip key={label.id} size="small" label={label.name} sx={{ bgcolor: label.color, color: "#fff" }} />
              ))}
            </Stack>
          )}
        </Stack>

        <Typography variant="body2" component="div">
          <EmailBody html={message.body_html} />
        </Typography>

        {message.attachments.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
            {message.attachments.map((a) => (
              <AttachmentChip key={a.id} attachmentId={a.id} fileName={a.file_name} />
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

/** TODO_SPEC.md "משימה 15" — the ✨ "סכם עם AI" / "הצע תשובה" row shown above a
 * thread's messages. Both actions POST to a per-thread AI endpoint
 * (routers/emails.py's `_require_recipient_row`-gated summarize/suggest-reply
 * — same mailbox-ownership check every other per-email operation in this app
 * already goes through, so this can never become a way to read a thread the
 * viewer isn't on) keyed on `rootEmailId`, which any message in the thread
 * resolves to on the backend.
 *
 * Summarize renders its result as a small dismissible info banner (own local
 * `dismissed` state, reset whenever a *new* summary successfully loads so
 * re-summarizing after dismissing shows the fresh result). Suggest-reply
 * never shows its result inline — spec step 4 requires the draft to always
 * land in an *editable* compose box before it could be sent, never
 * auto-inserted/auto-sent — so a successful call hands the draft straight to
 * `onOpenReply`, which Emails.tsx wires to opening EmailComposeModal in reply
 * mode (Task 8's initialTo/initialSubject/initialBody/inReplyTo props) with
 * the draft text pre-filled into the body field.
 *
 * A 503 (AI not configured) is shown as the same friendly sentence
 * CopilotWidget.tsx already uses for the identical condition elsewhere in
 * this app (see aiErrorMessage above), never a raw axios error. */
function EmailAiThreadActions({
  rootEmailId,
  lastMessage,
  onOpenReply,
}: {
  rootEmailId: number;
  lastMessage: Email;
  onOpenReply: (draft: ReplyDraft) => void;
}) {
  const [summaryDismissed, setSummaryDismissed] = useState(false);

  const summarizeMutation = useMutation({
    mutationFn: () => summarizeEmailThread(rootEmailId),
    onSuccess: () => setSummaryDismissed(false),
  });

  const suggestReplyMutation = useMutation({
    mutationFn: () => suggestEmailReply(rootEmailId),
    onSuccess: (data) => {
      const subject = lastMessage.subject.startsWith("Re:") ? lastMessage.subject : `Re: ${lastMessage.subject}`;
      onOpenReply({
        to: [lastMessage.sender.user_id],
        subject,
        body: data.draft,
        inReplyTo: lastMessage.email_id,
      });
    },
  });

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          variant="outlined"
          startIcon={
            summarizeMutation.isPending ? <CircularProgress size={14} /> : <AutoAwesomeIcon fontSize="small" />
          }
          disabled={summarizeMutation.isPending}
          onClick={() => summarizeMutation.mutate()}
          data-testid="summarize-thread-button"
        >
          {summarizeMutation.isPending ? "מסכם..." : "סכם עם AI"}
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={suggestReplyMutation.isPending ? <CircularProgress size={14} /> : <ReplyIcon fontSize="small" />}
          disabled={suggestReplyMutation.isPending}
          onClick={() => suggestReplyMutation.mutate()}
          data-testid="suggest-reply-button"
        >
          {suggestReplyMutation.isPending ? "מכין טיוטה..." : "הצע תשובה"}
        </Button>
      </Stack>

      {summarizeMutation.isSuccess && !summaryDismissed && (
        <Alert severity="info" onClose={() => setSummaryDismissed(true)} data-testid="thread-summary-banner">
          {summarizeMutation.data.summary}
        </Alert>
      )}
      {summarizeMutation.isError && (
        <Alert severity="warning" data-testid="thread-summary-error">
          {aiErrorMessage(summarizeMutation.error)}
        </Alert>
      )}
      {suggestReplyMutation.isError && (
        <Alert severity="warning" data-testid="suggest-reply-error">
          {aiErrorMessage(suggestReplyMutation.error)}
        </Alert>
      )}
    </Stack>
  );
}

function EmailThreadView({ emailId, onOpenReply }: { emailId: number; onOpenReply: (draft: ReplyDraft) => void }) {
  const thread = useQuery({ queryKey: ["email-thread", emailId], queryFn: () => fetchEmailThread(emailId) });

  if (thread.isLoading) {
    return <CircularProgress size={20} />;
  }
  if (thread.isError || !thread.data) {
    return <Alert severity="error">שגיאה בטעינת ההודעה.</Alert>;
  }

  const lastMessage = thread.data.messages[thread.data.messages.length - 1];

  return (
    <Stack spacing={2}>
      <EmailAiThreadActions rootEmailId={thread.data.root.email_id} lastMessage={lastMessage} onOpenReply={onOpenReply} />
      <EmailEntityLinkControl emailId={thread.data.root.email_id} />
      {thread.data.messages.map((message) => (
        <EmailMessageCard key={message.email_id} message={message} />
      ))}
    </Stack>
  );
}

/** TODO_SPEC.md "משימה 16" step 4 — the "⋮" action menu shown at the end of each
 * inbox row: a context-menu/overflow-menu action to add/remove a label from the
 * row's thread, offered as the honest alternative to real drag-and-drop (a
 * checkbox next to each of the caller's own labels, checked ones already tagging
 * this thread — clicking toggles attach/detach via POST/DELETE
 * /api/emails/{id}/tags[/...]). Stops click-propagation on its own IconButton so
 * opening the menu never also triggers the row's onClick (which opens the
 * thread and marks it read). */
function EmailLabelMenu({ item }: { item: EmailListItem }) {
  const queryClient = useQueryClient();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const labelsQuery = useQuery({ queryKey: ["labels"], queryFn: fetchLabels, enabled: anchorEl !== null });
  const appliedIds = new Set(item.labels.map((l) => l.id));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["emails"] });
  const addMutation = useMutation({
    mutationFn: (labelId: number) => addLabelToEmail(item.email_id, labelId),
    onSuccess: invalidate,
  });
  const removeMutation = useMutation({
    mutationFn: (labelId: number) => removeLabelFromEmail(item.email_id, labelId),
    onSuccess: invalidate,
  });

  const handleOpen = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setAnchorEl(e.currentTarget);
  };
  const handleClose = () => setAnchorEl(null);
  const handleToggle = (labelId: number, e: MouseEvent) => {
    e.stopPropagation();
    if (appliedIds.has(labelId)) removeMutation.mutate(labelId);
    else addMutation.mutate(labelId);
  };

  return (
    <>
      <IconButton size="small" onClick={handleOpen} aria-label={`תגיות עבור ${item.subject}`} data-testid={`email-row-menu-${item.email_id}`}>
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchorEl} open={anchorEl !== null} onClose={handleClose} onClick={(e) => e.stopPropagation()}>
        {(labelsQuery.data ?? []).length === 0 ? (
          <MenuItem disabled>אין תגיות — צרו תגית מתפריט הצד</MenuItem>
        ) : (
          (labelsQuery.data ?? []).map((label) => (
            <MenuItem key={label.id} onClick={(e) => handleToggle(label.id, e)} data-testid={`label-menu-item-${item.email_id}-${label.id}`}>
              <ListItemIcon>
                <Checkbox size="small" edge="start" checked={appliedIds.has(label.id)} tabIndex={-1} disableRipple />
              </ListItemIcon>
              <ListItemText primary={label.name} />
            </MenuItem>
          ))
        )}
      </Menu>
    </>
  );
}

/** TODO_SPEC.md "משימה 7" — main mailbox screen: folder nav (EmailSidebar) + a
 * folder-scoped list (sender/subject/date, bold when unread) + a thread detail
 * panel opened by clicking a row. See EmailListItem's own doc comment in
 * api/client.ts for why the list has no body excerpt column. */
export default function Emails() {
  const queryClient = useQueryClient();
  const [folder, setFolder] = useState<EmailFolder>("INBOX");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  // TODO_SPEC.md "משימה 16" step 5 — the active label filter, if any. Deliberately
  // does NOT reset when `folder` changes (see handleSelectFolder below) — folders
  // and labels compose ("show me INBOX emails tagged urgent"), so switching
  // folders while a label filter is active keeps that filter in effect.
  const [activeLabelId, setActiveLabelId] = useState<number | null>(null);

  // TODO_SPEC.md "משימה 15" step 4 — reply-mode pre-fill for EmailComposeModal
  // (Task 8's initialTo/initialSubject/initialBody/inReplyTo props), set by
  // EmailAiThreadActions' "הצע תשובה" once suggest-reply returns a draft.
  // `null` means the next compose open is a fresh message, not a reply —
  // cleared whenever "כתיבת מייל" itself is clicked, so a leftover draft from
  // a previous reply never leaks into an unrelated fresh compose.
  const [replyDraft, setReplyDraft] = useState<ReplyDraft | null>(null);

  const openComposeFresh = () => {
    setReplyDraft(null);
    setComposeOpen(true);
  };
  const openComposeReply = (draft: ReplyDraft) => {
    setReplyDraft(draft);
    setComposeOpen(true);
  };

  // TODO_SPEC.md "משימה 13" step 6 — badge count for the "מיילים מתוזמנים" button
  // (see ScheduledEmailsDialog.tsx for the actual list/cancel UI). Same
  // ["scheduled-emails"] query key that dialog and EmailComposeModal's
  // post-schedule invalidation use, so the badge and the dialog's own list
  // never disagree.
  const [scheduledDialogOpen, setScheduledDialogOpen] = useState(false);
  const scheduledCount = useQuery({
    queryKey: ["scheduled-emails"],
    queryFn: fetchScheduledEmails,
    select: (items) => items.length,
    staleTime: 15_000,
  });

  // TODO_SPEC.md "משימה 10" step 4: search box, debounced client-side so every
  // keystroke doesn't fire its own request — `search` (raw input) updates
  // immediately for a responsive textfield, `debouncedSearch` (what actually drives
  // the query) settles 300ms after typing stops. Mirrors GET /api/emails' own `q`
  // param (routers/emails.py / services/email.py's list_emails_for_user).
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  // TODO_SPEC.md "משימה 9": useSSE (mounted once in Layout.tsx) invalidates every
  // ["emails", ...] query — this one included — the instant a `new_email` SSE event
  // arrives, so refetchInterval below is now just a slow fallback for when the SSE
  // connection itself happens to be down, not the primary refresh mechanism.
  const list = useQuery({
    queryKey: ["emails", folder, debouncedSearch, activeLabelId],
    queryFn: () => fetchEmails(folder, 0, 50, debouncedSearch, activeLabelId),
    staleTime: 15_000,
    refetchInterval: 120_000,
  });

  const markReadMutation = useMutation({
    mutationFn: ({ emailId, isRead }: { emailId: number; isRead: boolean }) => markEmailRead(emailId, isRead),
    // Broad invalidation (every ["emails", ...] query) so both the current list and
    // EmailSidebar's per-folder unread badges refresh without a manual reload.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["emails"] }),
  });

  const handleSelectFolder = (nextFolder: EmailFolder) => {
    setFolder(nextFolder);
    setSelectedId(null);
  };

  const handleRowClick = (item: EmailListItem) => {
    setSelectedId(item.email_id);
    if (!item.is_read) {
      markReadMutation.mutate({ emailId: item.email_id, isRead: true });
    }
  };

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
        <Stack direction="row" spacing={1} alignItems="center">
          <MailOutlineIcon color="primary" fontSize="large" />
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              דואר
            </Typography>
            <Typography variant="caption" color="text.secondary">
              תיבת הדואר הפנימית של המערכת — התכתבויות בין עובדים.
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="outlined"
            startIcon={<ScheduleIcon />}
            onClick={() => setScheduledDialogOpen(true)}
            data-testid="scheduled-emails-button"
          >
            <Badge badgeContent={scheduledCount.data ?? 0} color="primary" sx={{ "& .MuiBadge-badge": { left: -14 } }}>
              מיילים מתוזמנים
            </Badge>
          </Button>
          <Button variant="contained" startIcon={<EditIcon />} onClick={openComposeFresh}>
            כתיבת מייל
          </Button>
        </Stack>
      </Stack>

      <EmailComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onReopen={() => setComposeOpen(true)}
        initialTo={replyDraft?.to}
        initialSubject={replyDraft?.subject}
        initialBody={replyDraft?.body}
        inReplyTo={replyDraft?.inReplyTo}
      />
      <ScheduledEmailsDialog open={scheduledDialogOpen} onClose={() => setScheduledDialogOpen(false)} />

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="flex-start">
        <Card variant="outlined" sx={{ flexShrink: 0, width: { xs: "100%", md: "auto" } }}>
          <EmailSidebar
            selected={folder}
            onSelect={handleSelectFolder}
            activeLabelId={activeLabelId}
            onSelectLabel={setActiveLabelId}
          />
        </Card>

        <Card variant="outlined" sx={{ flex: 1, minWidth: 0, width: "100%" }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
              {FOLDER_LABELS[folder]} ({list.data?.length ?? 0})
            </Typography>
            <TextField
              size="small"
              fullWidth
              placeholder="חיפוש לפי נושא, תוכן או שם שולח..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ mb: 1.5 }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                },
              }}
              data-testid="email-search-input"
            />
            {list.isLoading ? (
              <CircularProgress size={20} />
            ) : (list.data ?? []).length > 0 ? (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>שולח</TableCell>
                    <TableCell>נושא</TableCell>
                    <TableCell>תאריך</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(list.data ?? []).map((item) => (
                    <TableRow
                      key={item.email_id}
                      hover
                      selected={item.email_id === selectedId}
                      onClick={() => handleRowClick(item)}
                      sx={{ cursor: "pointer" }}
                      data-testid={`email-row-${item.email_id}`}
                    >
                      <TableCell style={{ fontWeight: item.is_read ? 400 : 700 }}>{item.sender.full_name}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                          <span style={{ fontWeight: item.is_read ? 400 : 700 }}>{item.subject}</span>
                          {item.labels.map((label) => (
                            <Chip
                              key={label.id}
                              size="small"
                              label={label.name}
                              sx={{ bgcolor: label.color, color: "#fff", height: 18, fontSize: "0.7rem" }}
                            />
                          ))}
                        </Stack>
                      </TableCell>
                      <TableCell>{formatDateTime(item.created_at)}</TableCell>
                      <TableCell padding="none" onClick={(e) => e.stopPropagation()}>
                        <EmailLabelMenu item={item} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {debouncedSearch ? "לא נמצאו הודעות התואמות לחיפוש." : "אין הודעות בתיקייה זו."}
              </Typography>
            )}
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ flex: 1, minWidth: 0, width: "100%" }}>
          <CardContent>
            {selectedId ? (
              <EmailThreadView emailId={selectedId} onOpenReply={openComposeReply} />
            ) : (
              <Typography variant="body2" color="text.secondary">
                בחרו הודעה מהרשימה כדי לצפות בתוכן.
              </Typography>
            )}
          </CardContent>
        </Card>
      </Stack>
    </Stack>
  );
}
