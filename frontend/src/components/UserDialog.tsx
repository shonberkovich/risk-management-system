import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { createUser, updateUser, type UserAdmin } from "../api/client";
import { apiErrorMessage } from "../api/errors";
import { isValidEmail, MIN_PASSWORD_LENGTH, ROLE_LABELS } from "../format";

const FIELD_LABELS = { full_name: "שם מלא", email: "אימייל", role: "תפקיד", password: "סיסמה" };

const ROLE_OPTIONS = Object.keys(ROLE_LABELS);

const emptyForm = {
  full_name: "",
  email: "",
  role: "FIELD_WORKER",
  password: "",
  is_active: true,
};

export default function UserDialog({
  open,
  user,
  isSelf = false,
  onClose,
}: {
  open: boolean;
  user: UserAdmin | null;
  /** Editing the signed-in admin: the backend refuses changing your own role or disabling yourself. */
  isSelf?: boolean;
  onClose: () => void;
}) {
  // Phones (and landscape phones, whose height is too short for a floating dialog)
  // get the form full-screen so every field and the action row stay reachable.
  const fullScreen = useMediaQuery("(max-width:599.95px), (max-height:500px)");
  const [form, setForm] = useState(emptyForm);
  const queryClient = useQueryClient();
  const isEdit = user !== null;

  const mutation = useMutation({
    mutationFn: () => {
      if (isEdit) {
        return updateUser(user!.user_id, {
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          role: form.role,
          password: form.password.trim() ? form.password : undefined,
          is_active: form.is_active,
        });
      }
      return createUser({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        role: form.role,
        password: form.password.trim() ? form.password : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users-admin"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
  });

  useEffect(() => {
    mutation.reset(); // the previous attempt's error doesn't belong to this opening
    if (user) {
      setForm({
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        password: "",
        is_active: user.is_active,
      });
    } else {
      setForm(emptyForm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on (re)open only
  }, [user, open]);

  const emailError = form.email.trim() !== "" && !isValidEmail(form.email.trim());
  const passwordError = form.password.trim() !== "" && form.password.length < MIN_PASSWORD_LENGTH;
  const canSubmit = form.full_name.trim() && form.email.trim() && form.role && !emailError && !passwordError;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <DialogTitle>{isEdit ? "עריכת משתמש" : "משתמש חדש"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                label="שם מלא"
                inputProps={{ maxLength: 100 }}
                fullWidth
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
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
                select
                label="תפקיד"
                fullWidth
                value={form.role}
                disabled={isSelf}
                helperText={isSelf ? "לא ניתן לשנות את התפקיד של עצמך" : undefined}
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
                // The guidance lives in helperText: as part of the label it was cut off with an
                // ellipsis in the half-width column and on phones.
                label={isEdit ? "איפוס סיסמה" : "סיסמה"}
                type="password"
                fullWidth
                inputProps={{ maxLength: 128 }}
                value={form.password}
                error={passwordError}
                helperText={
                  passwordError
                    ? `לפחות ${MIN_PASSWORD_LENGTH} תווים`
                    : isEdit
                      ? "השאירו ריק לשמירת הסיסמה הקיימת"
                      : "ריק = ללא סיסמה מקומית, SSO בלבד"
                }
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </Grid>
            {isEdit && (
              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={form.is_active}
                      disabled={isSelf}
                      onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                    />
                  }
                  label={form.is_active ? "משתמש פעיל" : "משתמש מושבת (לא יוכל להתחבר)"}
                />
              </Grid>
            )}
          </Grid>

          {mutation.isError && (
            <Alert severity="error">
              {apiErrorMessage(mutation.error, isEdit ? "עדכון המשתמש נכשל." : "יצירת המשתמש נכשלה.", FIELD_LABELS)}
            </Alert>
          )}
          {!isEdit && (
            <Typography variant="caption" color="text.secondary">
              לאחר היצירה, המשתמש יוכל להתחבר עם האימייל והסיסמה שהוגדרו כאן (אם הוגדרה סיסמה).
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>ביטול</Button>
        <Button variant="contained" disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
          {isEdit ? "שמירה" : "יצירה"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
