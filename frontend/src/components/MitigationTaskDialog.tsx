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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  createMitigationTask,
  fetchProperties,
  fetchUsers,
  updateMitigationTask,
  type MitigationStatus,
  type MitigationTask,
} from "../api/client";
import { MITIGATION_STATUS_LABELS } from "../format";

const STATUS_OPTIONS: MitigationStatus[] = ["OPEN", "IN_PROGRESS", "COMPLETED", "OVERDUE"];

const emptyForm = {
  property_id: "" as number | "",
  title: "",
  cost_estimate: "",
  expected_annual_savings: "",
  due_date: "",
  status: "OPEN" as MitigationStatus,
  assigned_to_user_id: "" as number | "",
};

export default function MitigationTaskDialog({
  open,
  task,
  onClose,
}: {
  open: boolean;
  task: MitigationTask | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const queryClient = useQueryClient();
  const isEdit = task !== null;

  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const users = useQuery({ queryKey: ["users"], queryFn: fetchUsers });

  useEffect(() => {
    if (task) {
      setForm({
        property_id: task.property_id,
        title: task.title,
        cost_estimate: String(task.cost_estimate),
        expected_annual_savings: String(task.expected_annual_savings),
        due_date: task.due_date.slice(0, 10),
        status: task.status,
        assigned_to_user_id: task.assigned_to_user_id ?? "",
      });
    } else {
      setForm(emptyForm);
    }
  }, [task, open]);

  const mutation = useMutation({
    mutationFn: () => {
      if (isEdit) {
        return updateMitigationTask(task!.task_id, {
          title: form.title.trim(),
          cost_estimate: Number(form.cost_estimate) || 0,
          expected_annual_savings: Number(form.expected_annual_savings) || 0,
          due_date: form.due_date,
          status: form.status,
          assigned_to_user_id: form.assigned_to_user_id === "" ? null : Number(form.assigned_to_user_id),
        });
      }
      return createMitigationTask({
        property_id: Number(form.property_id),
        title: form.title.trim(),
        cost_estimate: Number(form.cost_estimate) || 0,
        expected_annual_savings: Number(form.expected_annual_savings) || 0,
        due_date: form.due_date,
        assigned_to_user_id: form.assigned_to_user_id === "" ? null : Number(form.assigned_to_user_id),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mitigation-tasks"] });
      onClose();
    },
  });

  const canSubmit =
    (isEdit || form.property_id !== "") && form.title.trim() && form.cost_estimate !== "" && form.due_date;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? "עריכת משימת הפחתת סיכון" : "משימת הפחתת סיכון חדשה"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                select
                label="נכס"
                fullWidth
                disabled={isEdit}
                value={form.property_id}
                onChange={(e) => setForm((f) => ({ ...f, property_id: Number(e.target.value) }))}
              >
                {(properties.data ?? []).map((p) => (
                  <MenuItem key={p.property_id} value={p.property_id}>
                    {p.name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="כותרת המשימה"
                fullWidth
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                label="עלות משוערת (₪)"
                type="number"
                fullWidth
                value={form.cost_estimate}
                onChange={(e) => setForm((f) => ({ ...f, cost_estimate: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                label="חיסכון שנתי צפוי (₪)"
                type="number"
                fullWidth
                value={form.expected_annual_savings}
                onChange={(e) => setForm((f) => ({ ...f, expected_annual_savings: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                label="תאריך יעד"
                type="date"
                fullWidth
                InputLabelProps={{ shrink: true }}
                value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                select
                label="גורם מבצע"
                fullWidth
                value={form.assigned_to_user_id}
                onChange={(e) =>
                  setForm((f) => ({ ...f, assigned_to_user_id: e.target.value === "" ? "" : Number(e.target.value) }))
                }
              >
                <MenuItem value="">לא משויך</MenuItem>
                {(users.data ?? []).map((u) => (
                  <MenuItem key={u.user_id} value={u.user_id}>
                    {u.full_name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            {isEdit && (
              <Grid item xs={12}>
                <TextField
                  select
                  label="סטטוס"
                  fullWidth
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as MitigationStatus }))}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <MenuItem key={s} value={s}>
                      {MITIGATION_STATUS_LABELS[s]}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            )}
          </Grid>

          {mutation.isError && (
            <Alert severity="error">{isEdit ? "עדכון המשימה נכשל." : "יצירת המשימה נכשלה."}</Alert>
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
