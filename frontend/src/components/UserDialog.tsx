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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { createUser, updateUser, type UserAdmin } from "../api/client";
import { ROLE_LABELS } from "../format";

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
  onClose,
}: {
  open: boolean;
  user: UserAdmin | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const queryClient = useQueryClient();
  const isEdit = user !== null;

  useEffect(() => {
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
  }, [user, open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (isEdit) {
        return updateUser(user!.user_id, {
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          role: form.role,
          password: form.password.trim() ? form.password.trim() : undefined,
          is_active: form.is_active,
        });
      }
      return createUser({
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        role: form.role,
        password: form.password.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users-admin"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
  });

  const canSubmit = form.full_name.trim() && form.email.trim() && form.role;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? "עריכת משתמש" : "משתמש חדש"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                label="שם מלא"
                fullWidth
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
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
                label={isEdit ? "איפוס סיסמה (השאירו ריק לשמירת הקיימת)" : "סיסמה (ריק = ללא סיסמה מקומית, SSO בלבד)"}
                type="password"
                fullWidth
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </Grid>
            {isEdit && (
              <Grid item xs={12}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={form.is_active}
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
              {isEdit ? "עדכון המשתמש נכשל." : "יצירת המשתמש נכשלה — ייתכן שהאימייל כבר קיים."}
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
