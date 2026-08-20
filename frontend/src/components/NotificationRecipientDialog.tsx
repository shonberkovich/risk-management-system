import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  createNotificationRecipient,
  updateNotificationRecipient,
  type NotificationChannel,
  type NotificationRecipient,
  type NotificationSeverity,
} from "../api/client";
import { ROLE_LABELS } from "../format";

const ROLE_OPTIONS = Object.keys(ROLE_LABELS);
const CHANNEL_OPTIONS: NotificationChannel[] = ["EMAIL", "SMS", "PUSH"];
const CHANNEL_LABELS: Record<NotificationChannel, string> = { EMAIL: "אימייל", SMS: "SMS", PUSH: "Push" };
const SEVERITY_OPTIONS: NotificationSeverity[] = ["warning", "critical"];
const SEVERITY_OPTION_LABELS: Record<NotificationSeverity, string> = { warning: "אזהרה ומעלה", critical: "קריטי בלבד" };

const emptyForm = {
  role: ROLE_OPTIONS[0],
  display_name: "",
  email: "",
  phone: "",
  channels: ["EMAIL"] as NotificationChannel[],
  min_severity: "warning" as NotificationSeverity,
  is_active: true,
};

export default function NotificationRecipientDialog({
  open,
  recipient,
  onClose,
}: {
  open: boolean;
  recipient: NotificationRecipient | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const queryClient = useQueryClient();
  const isEdit = recipient !== null;

  useEffect(() => {
    if (recipient) {
      setForm({
        role: recipient.role,
        display_name: recipient.display_name,
        email: recipient.email,
        phone: recipient.phone,
        channels: recipient.channels,
        min_severity: recipient.min_severity,
        is_active: recipient.is_active,
      });
    } else {
      setForm(emptyForm);
    }
  }, [recipient, open]);

  const toggleChannel = (c: NotificationChannel) =>
    setForm((f) => ({
      ...f,
      channels: f.channels.includes(c) ? f.channels.filter((x) => x !== c) : [...f.channels, c],
    }));

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        role: form.role,
        display_name: form.display_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        channels: form.channels,
        min_severity: form.min_severity,
        is_active: form.is_active,
      };
      return isEdit ? updateNotificationRecipient(recipient!.recipient_id, payload) : createNotificationRecipient(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-recipients"] });
      onClose();
    },
  });

  const canSubmit = form.display_name.trim() && form.channels.length > 0 && (form.email.trim() || form.phone.trim());

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? "עריכת נמען" : "נמען חדש"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Grid container spacing={2}>
            <Grid item xs={6}>
              <TextField
                select
                label="תפקיד"
                fullWidth
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              >
                {ROLE_OPTIONS.map((r) => (
                  <MenuItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={6}>
              <TextField
                select
                label="סף חומרה מינימלי"
                fullWidth
                value={form.min_severity}
                onChange={(e) => setForm((f) => ({ ...f, min_severity: e.target.value as NotificationSeverity }))}
              >
                {SEVERITY_OPTIONS.map((s) => (
                  <MenuItem key={s} value={s}>
                    {SEVERITY_OPTION_LABELS[s]}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="שם תצוגה"
                fullWidth
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                label="אימייל"
                type="email"
                fullWidth
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                label="טלפון"
                fullWidth
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </Grid>
            <Grid item xs={7}>
              <Typography variant="caption" color="text.secondary" display="block">
                ערוצי התראה
              </Typography>
              <FormGroup row>
                {CHANNEL_OPTIONS.map((c) => (
                  <FormControlLabel
                    key={c}
                    control={<Checkbox checked={form.channels.includes(c)} onChange={() => toggleChannel(c)} />}
                    label={CHANNEL_LABELS[c]}
                  />
                ))}
              </FormGroup>
            </Grid>
            <Grid item xs={5}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.is_active}
                    onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  />
                }
                label="פעיל"
              />
            </Grid>
          </Grid>

          {mutation.isError && <Alert severity="error">שמירת הנמען נכשלה.</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>ביטול</Button>
        <Button variant="contained" disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
          שמירה
        </Button>
      </DialogActions>
    </Dialog>
  );
}
