import AttachFileIcon from "@mui/icons-material/AttachFile";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  fetchEmailAttachmentSignedUrl,
  fetchEmailThread,
  fetchEmails,
  markEmailRead,
  type Email,
  type EmailFolder,
  type EmailListItem,
} from "../api/client";
import EmailSidebar from "../components/EmailSidebar";
import { formatDateTime } from "../format";

const FOLDER_LABELS: Record<EmailFolder, string> = {
  INBOX: "דואר נכנס",
  SENT: "נשלח",
  ARCHIVE: "ארכיון",
  TRASH: "אשפה",
  SPAM: "דואר זבל",
};

/** Renders body_html as plain text without dangerouslySetInnerHTML, as an interim
 * XSS stopgap: the backend doesn't sanitize body_html yet (Task 10 adds server-side
 * `bleach` sanitization), and no HTML sanitizer library is already a dependency here
 * (see frontend/package.json — nothing suitable, and this task's brief says not to
 * add a new heavy dependency just for this). DOMParser builds a detached document
 * (never inserted into the live DOM), so embedded <script>/event-handler markup
 * never executes; only .textContent is read back out, discarding every tag.
 * TODO Task 10: once body_html is sanitized server-side, this can render real HTML. */
function stripHtml(html: string): string {
  try {
    return new DOMParser().parseFromString(html, "text/html").body.textContent?.trim() ?? "";
  } catch {
    return html;
  }
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

        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
          {stripHtml(message.body_html)}
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

  const list = useQuery({
    queryKey: ["emails", folder],
    queryFn: () => fetchEmails(folder),
    staleTime: 15_000,
    refetchInterval: 30_000,
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

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="flex-start">
        <Card variant="outlined" sx={{ flexShrink: 0, width: { xs: "100%", md: "auto" } }}>
          <EmailSidebar selected={folder} onSelect={handleSelectFolder} />
        </Card>

        <Card variant="outlined" sx={{ flex: 1, minWidth: 0, width: "100%" }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
              {FOLDER_LABELS[folder]} ({list.data?.length ?? 0})
            </Typography>
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
                אין הודעות בתיקייה זו.
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
