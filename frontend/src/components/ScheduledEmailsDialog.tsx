import CancelIcon from "@mui/icons-material/Cancel";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { cancelScheduledEmail, fetchScheduledEmails } from "../api/client";
import { formatDateTime } from "../format";

/** TODO_SPEC.md "משימה 13" step 6 — "somewhere the user can see/manage their
 * scheduled-but-not-yet-sent emails and cancel them". Kept as a small,
 * self-contained Dialog (opened from a button in Emails.tsx) rather than a
 * full extra folder/panel in the three-column mailbox layout — a scheduled
 * email has no thread/body-reading view of its own to justify that much
 * screen real estate (it isn't even readable via GET /api/emails/{id} yet,
 * see routers/emails.py's module docstring), just a list to review and cancel
 * from. `["scheduled-emails"]` is invalidated here (after cancel) and by
 * EmailComposeModal.tsx (after a successful schedule), so this list and the
 * badge count in Emails.tsx always agree. */
export default function ScheduledEmailsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const scheduled = useQuery({
    queryKey: ["scheduled-emails"],
    queryFn: fetchScheduledEmails,
    enabled: open,
  });

  const cancelMutation = useMutation({
    mutationFn: (emailId: number) => cancelScheduledEmail(emailId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scheduled-emails"] }),
  });

  const recipientSummary = (names: { full_name: string }[]) =>
    names.length > 0 ? names.map((u) => u.full_name).join(", ") : "—";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>מיילים מתוזמנים</DialogTitle>
      <DialogContent>
        {scheduled.isLoading ? (
          <CircularProgress size={20} />
        ) : (scheduled.data ?? []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            אין מיילים המתוזמנים לשליחה עתידית.
          </Typography>
        ) : (
          <List dense data-testid="scheduled-emails-list">
            {(scheduled.data ?? []).map((email) => (
              <ListItem
                key={email.email_id}
                data-testid={`scheduled-email-${email.email_id}`}
                secondaryAction={
                  <IconButton
                    edge="end"
                    aria-label={`ביטול תזמון: ${email.subject}`}
                    onClick={() => cancelMutation.mutate(email.email_id)}
                    disabled={cancelMutation.isPending}
                  >
                    <CancelIcon fontSize="small" color="error" />
                  </IconButton>
                }
              >
                <ListItemText
                  primary={email.subject}
                  secondary={`אל: ${recipientSummary(email.to)} · יישלח ב-${formatDateTime(email.scheduled_for)}`}
                />
              </ListItem>
            ))}
          </List>
        )}
        {cancelMutation.isError && <Alert severity="error">ביטול התזמון נכשל. נסו שוב.</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>סגירה</Button>
      </DialogActions>
    </Dialog>
  );
}
