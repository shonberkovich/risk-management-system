import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { createRolePermission, updateRolePermission, type RolePermission } from "../api/client";
import { ROLE_LABELS } from "../format";

const ROLE_OPTIONS = Object.keys(ROLE_LABELS);

const emptyForm = { role: "FIELD_WORKER", permission_key: "", description: "" };

export default function RolePermissionDialog({
  open,
  permission,
  onClose,
}: {
  open: boolean;
  permission: RolePermission | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const queryClient = useQueryClient();
  const isEdit = permission !== null;

  useEffect(() => {
    if (permission) {
      setForm({
        role: permission.role,
        permission_key: permission.permission_key,
        description: permission.description ?? "",
      });
    } else {
      setForm(emptyForm);
    }
  }, [permission, open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (isEdit) {
        // role + permission_key together identify the row (UQ_RolePermissions_RoleKey) —
        // only description is actually editable, same as backend's RolePermissionUpdate shape.
        return updateRolePermission(permission!.role_permission_id, {
          description: form.description.trim() || null,
        });
      }
      return createRolePermission({
        role: form.role,
        permission_key: form.permission_key.trim(),
        description: form.description.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["role-permissions"] });
      onClose();
    },
  });

  const canSubmit = form.role && (isEdit || form.permission_key.trim());

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? "עריכת הרשאה" : "הרשאה חדשה"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                select
                label="תפקיד"
                fullWidth
                disabled={isEdit}
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
            <Grid item xs={12}>
              <TextField
                label="מפתח הרשאה (permission_key)"
                fullWidth
                disabled={isEdit}
                value={form.permission_key}
                onChange={(e) => setForm((f) => ({ ...f, permission_key: e.target.value }))}
                helperText={isEdit ? undefined : 'למשל: "VIEW_FINANCIALS", "EDIT_CLAIMS"'}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="תיאור"
                fullWidth
                multiline
                minRows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Grid>
          </Grid>

          {mutation.isError && (
            <Alert severity="error">
              {isEdit ? "עדכון ההרשאה נכשל." : "יצירת ההרשאה נכשלה — ייתכן שההרשאה כבר קיימת עבור תפקיד זה."}
            </Alert>
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
