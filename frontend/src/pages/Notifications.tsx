import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import RefreshIcon from "@mui/icons-material/Refresh";
import SendIcon from "@mui/icons-material/Send";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  deleteNotificationRecipient,
  dispatchNotifications,
  fetchNotificationLog,
  fetchNotificationRecipients,
  previewNotifications,
  type NotificationRecipient,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import NotificationRecipientDialog from "../components/NotificationRecipientDialog";
import { ROLE_LABELS, formatDateTime } from "../format";

const ALERT_TYPE_LABELS: Record<string, string> = {
  geographic_exposure: "חשיפה גיאוגרפית מרוכזת",
  incident_concentration: "ריכוז אירועים בנכס",
  critical_incident: "אירוע קריטי",
};
const SEVERITY_LABELS: Record<string, string> = { warning: "אזהרה", critical: "קריטי" };
const SEVERITY_COLOR: Record<string, "warning" | "error"> = { warning: "warning", critical: "error" };
const CHANNEL_LABELS: Record<string, string> = { EMAIL: "אימייל", SMS: "SMS", PUSH: "Push" };

const NOTIFICATIONS_ROLES = ["RISK_MANAGER", "CFO", "ADMIN"];
const RECIPIENTS_WRITE_ROLES = ["ADMIN"];

/** TODO_SPEC.md §5, "מסכי אינטגרציה והתראות" — viewing the alert-routing preview, triggering
 * a (simulated, see services/notifications.py) dispatch, the dispatch audit log, and managing
 * who alerts are routed to. No new backend surface — routers/notifications.py already had
 * every endpoint this page uses. */
export default function Notifications() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canRead = !!user && NOTIFICATIONS_ROLES.includes(user.role);
  const canManageRecipients = !!user && RECIPIENTS_WRITE_ROLES.includes(user.role);

  const [dialogRecipient, setDialogRecipient] = useState<NotificationRecipient | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const preview = useQuery({ queryKey: ["notifications-preview"], queryFn: previewNotifications, enabled: canRead });
  const log = useQuery({ queryKey: ["notifications-log"], queryFn: () => fetchNotificationLog(), enabled: canRead });
  const recipients = useQuery({
    queryKey: ["notification-recipients"],
    queryFn: fetchNotificationRecipients,
    enabled: canRead,
  });

  const dispatchMutation = useMutation({
    mutationFn: dispatchNotifications,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications-log"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-preview"] });
    },
  });

  const removeRecipientMutation = useMutation({
    mutationFn: deleteNotificationRecipient,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-recipients"] }),
  });

  if (!canRead) {
    return <Alert severity="error">מסך זה זמין למנהלי סיכונים, סמנכ"לי כספים ומנהלי מערכת בלבד.</Alert>;
  }

  const openCreate = () => {
    setDialogRecipient(null);
    setDialogOpen(true);
  };
  const openEdit = (r: NotificationRecipient) => {
    setDialogRecipient(r);
    setDialogOpen(true);
  };

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} alignItems="center">
        <NotificationsActiveIcon color="primary" fontSize="large" />
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            התראות
          </Typography>
          <Typography variant="caption" color="text.secondary">
            ניתוב התראות סף (חשיפה גיאוגרפית, ריכוז אירועים, אירועים קריטיים) לנמענים, שליחה (מדומה), ויומן שליחות.
          </Typography>
        </Box>
      </Stack>

      {preview.data && preview.data.length === 0 && !dispatchMutation.data && (
        <Alert severity="success">אין כרגע התראות סף פעילות הממתינות לניתוב.</Alert>
      )}

      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              תצוגה מקדימה — מי יקבל התראה כרגע ({preview.data?.length ?? 0})
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                startIcon={<RefreshIcon />}
                onClick={() => preview.refetch()}
                disabled={preview.isFetching}
              >
                רענון
              </Button>
              <Button
                size="small"
                variant="contained"
                color="warning"
                startIcon={<SendIcon />}
                disabled={dispatchMutation.isPending || (preview.data?.length ?? 0) === 0}
                onClick={() => {
                  if (window.confirm("לשלוח (באופן מדומה) את כל ההתראות הפעילות לכל הנמענים המתאימים?")) {
                    dispatchMutation.mutate();
                  }
                }}
              >
                שליחה עכשיו
              </Button>
            </Stack>
          </Stack>

          {dispatchMutation.isSuccess && (
            <Alert severity="success" sx={{ mb: 1.5 }}>
              נשלחו {dispatchMutation.data.length} התראות (מדומות).
            </Alert>
          )}
          {dispatchMutation.isError && (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              שליחת ההתראות נכשלה.
            </Alert>
          )}

          {preview.isLoading ? (
            <CircularProgress size={20} />
          ) : (preview.data ?? []).length > 0 ? (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>סוג התראה</TableCell>
                  <TableCell>חומרה</TableCell>
                  <TableCell>נמען</TableCell>
                  <TableCell>ערוץ</TableCell>
                  <TableCell>כותרת</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(preview.data ?? []).map((n, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{ALERT_TYPE_LABELS[n.alert_type] ?? n.alert_type}</TableCell>
                    <TableCell>
                      <Chip size="small" label={SEVERITY_LABELS[n.severity] ?? n.severity} color={SEVERITY_COLOR[n.severity]} />
                    </TableCell>
                    <TableCell>
                      {n.recipient_name} ({ROLE_LABELS[n.recipient_role] ?? n.recipient_role})
                    </TableCell>
                    <TableCell>{CHANNEL_LABELS[n.channel] ?? n.channel}</TableCell>
                    <TableCell>{n.title}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Typography variant="body2" color="text.secondary">
              אין כרגע התראות סף פעילות.
            </Typography>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
            יומן התראות שנשלחו ({log.data?.length ?? 0})
          </Typography>
          {log.isLoading ? (
            <CircularProgress size={20} />
          ) : (log.data ?? []).length > 0 ? (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>נשלח בתאריך</TableCell>
                  <TableCell>סוג</TableCell>
                  <TableCell>חומרה</TableCell>
                  <TableCell>נמען</TableCell>
                  <TableCell>ערוץ</TableCell>
                  <TableCell>יעד</TableCell>
                  <TableCell>סטטוס</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(log.data ?? []).map((l) => (
                  <TableRow key={l.log_id} hover>
                    <TableCell>{formatDateTime(l.sent_at)}</TableCell>
                    <TableCell>{ALERT_TYPE_LABELS[l.alert_type] ?? l.alert_type}</TableCell>
                    <TableCell>
                      <Chip size="small" label={SEVERITY_LABELS[l.severity] ?? l.severity} color={SEVERITY_COLOR[l.severity]} />
                    </TableCell>
                    <TableCell>{l.recipient_name}</TableCell>
                    <TableCell>{CHANNEL_LABELS[l.channel] ?? l.channel}</TableCell>
                    <TableCell sx={{ direction: "ltr", textAlign: "right" }}>{l.contact}</TableCell>
                    <TableCell>{l.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Typography variant="body2" color="text.secondary">
              עדיין לא נשלחו התראות.
            </Typography>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              נמענים ({recipients.data?.length ?? 0})
            </Typography>
            {canManageRecipients && (
              <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={openCreate}>
                נמען חדש
              </Button>
            )}
          </Stack>
          {recipients.isLoading ? (
            <CircularProgress size={20} />
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>שם</TableCell>
                  <TableCell>תפקיד</TableCell>
                  <TableCell>ערוצים</TableCell>
                  <TableCell>סף חומרה</TableCell>
                  <TableCell>סטטוס</TableCell>
                  {canManageRecipients && <TableCell align="left">פעולות</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {(recipients.data ?? []).map((r) => (
                  <TableRow key={r.recipient_id} hover>
                    <TableCell>{r.display_name}</TableCell>
                    <TableCell>
                      <Chip size="small" label={ROLE_LABELS[r.role] ?? r.role} />
                    </TableCell>
                    <TableCell>{r.channels.map((c) => CHANNEL_LABELS[c] ?? c).join(", ")}</TableCell>
                    <TableCell>{r.min_severity === "critical" ? "קריטי בלבד" : "אזהרה ומעלה"}</TableCell>
                    <TableCell>
                      <Chip size="small" label={r.is_active ? "פעיל" : "לא פעיל"} color={r.is_active ? "success" : "default"} />
                    </TableCell>
                    {canManageRecipients && (
                      <TableCell align="left">
                        <Tooltip title="עריכה">
                          <IconButton size="small" onClick={() => openEdit(r)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="מחיקה">
                          <IconButton
                            size="small"
                            disabled={removeRecipientMutation.isPending}
                            onClick={() => {
                              if (window.confirm(`למחוק את הנמען "${r.display_name}"?`)) {
                                removeRecipientMutation.mutate(r.recipient_id);
                              }
                            }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NotificationRecipientDialog open={dialogOpen} recipient={dialogRecipient} onClose={() => setDialogOpen(false)} />
    </Stack>
  );
}
