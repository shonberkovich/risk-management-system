import AttachFileIcon from "@mui/icons-material/AttachFile";
import EditIcon from "@mui/icons-material/Edit";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import SearchIcon from "@mui/icons-material/Search";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  fetchEmailAttachmentSignedUrl,
  fetchEmailThread,
  fetchEmails,
  markEmailRead,
  type Email,
  type EmailFolder,
  type EmailListItem,
} from "../api/client";
import EmailComposeModal from "../components/EmailComposeModal";
import EmailEntityLinkControl from "../components/EmailEntityLinkControl";
import EmailSidebar from "../components/EmailSidebar";
import { formatDateTime } from "../format";

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

function EmailThreadView({ emailId }: { emailId: number }) {
  const thread = useQuery({ queryKey: ["email-thread", emailId], queryFn: () => fetchEmailThread(emailId) });

  if (thread.isLoading) {
    return <CircularProgress size={20} />;
  }
  if (thread.isError || !thread.data) {
    return <Alert severity="error">שגיאה בטעינת ההודעה.</Alert>;
  }

  return (
    <Stack spacing={2}>
      <EmailEntityLinkControl emailId={thread.data.root.email_id} />
      {thread.data.messages.map((message) => (
        <EmailMessageCard key={message.email_id} message={message} />
      ))}
    </Stack>
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
    queryKey: ["emails", folder, debouncedSearch],
    queryFn: () => fetchEmails(folder, 0, 50, debouncedSearch),
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
        <Button variant="contained" startIcon={<EditIcon />} onClick={() => setComposeOpen(true)}>
          כתיבת מייל
        </Button>
      </Stack>

      <EmailComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} />

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="flex-start">
        <Card variant="outlined" sx={{ flexShrink: 0, width: { xs: "100%", md: "auto" } }}>
          <EmailSidebar selected={folder} onSelect={handleSelectFolder} />
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
                      <TableCell style={{ fontWeight: item.is_read ? 400 : 700 }}>{item.subject}</TableCell>
                      <TableCell>{formatDateTime(item.created_at)}</TableCell>
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
              <EmailThreadView emailId={selectedId} />
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
