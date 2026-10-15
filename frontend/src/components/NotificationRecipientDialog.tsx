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
import useMediaQuery from "@mui/material/useMediaQuery";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  createNotificationRecipient,
  updateNotificationRecipient,
  type NotificationChannel,
  type NotificationRecipient,
  type NotificationSeverity,
} from "../api/client";
import { apiErrorMessage } from "../api/errors";
import { isValidEmail, isValidPhone, ROLE_LABELS } from "../format";

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
  // Phones (and landscape phones, whose height is too short for a floating dialog)
  // get the form full-screen so every field and the action row stay reachable.
  const fullScreen = useMediaQuery("(max-width:599.95px), (max-height:500px)");
  const [form, setForm] = useState(emptyForm);
  const queryClient = useQueryClient();
  const isEdit = recipient !== null;

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

  useEffect(() => {
    mutation.reset(); // the previous attempt's error doesn't belong to this opening
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on (re)open only
  }, [recipient, open]);

  const emailError = form.email.trim() !== "" && !isValidEmail(form.email.trim());
  const phoneError = form.phone.trim() !== "" && !isValidPhone(form.phone.trim());
  const canSubmit =
    form.display_name.trim() &&
    form.channels.length > 0 &&
    (form.email.trim() || form.phone.trim()) &&
    !emailError &&
    !phoneError;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <DialogTitle>{isEdit ? "עריכת נמען" : "נמען חדש"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
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
            <Grid item xs={12} sm={6}>
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
                inputProps={{ maxLength: 100 }}
                fullWidth
                value={form.display_name}
                onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="אימייל"
                inputProps={{ maxLength: 200 }}
                type="email"
                fullWidth
                value={form.email}
                error={emailError}
                helperText={emailError ? "כתובת אימייל לא תקינה" : undefined}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="טלפון"
                inputProps={{ maxLength: 30 }}
                fullWidth
                value={form.phone}
                error={phoneError}
                helperText={phoneError ? "מספר טלפון לא תקין" : undefined}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={7}>
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
            <Grid item xs={12} sm={5}>
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

          {mutation.isError && (
            <Alert severity="error">
              {apiErrorMessage(mutation.error, "שמירת הנמען נכשלה.", {
                display_name: "שם תצוגה",
                email: "אימייל",
                phone: "טלפון",
                role: "תפקיד",
              })}
            </Alert>
          )}
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
