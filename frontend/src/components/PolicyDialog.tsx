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

import { createPolicy, updatePolicy, type Policy, type PolicyStatus } from "../api/client";
import { POLICY_STATUS_LABELS } from "../format";

const STATUS_OPTIONS: PolicyStatus[] = ["ACTIVE", "PENDING_RENEWAL", "EXPIRED"];

const emptyForm = {
  policy_number: "",
  insurer_name: "",
  start_date: "",
  end_date: "",
  total_limit: "",
  deductible_default: "",
  annual_premium: "",
  status: "ACTIVE" as PolicyStatus,
};

export default function PolicyDialog({
  open,
  policy,
  onClose,
}: {
  open: boolean;
  policy: Policy | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const queryClient = useQueryClient();
  const isEdit = policy !== null;

  useEffect(() => {
    if (policy) {
      setForm({
        policy_number: policy.policy_number,
        insurer_name: policy.insurer_name,
        start_date: policy.start_date.slice(0, 10),
        end_date: policy.end_date.slice(0, 10),
        total_limit: String(policy.total_limit),
        deductible_default: String(policy.deductible_default),
        annual_premium: String(policy.annual_premium),
        status: policy.status,
      });
    } else {
      setForm(emptyForm);
    }
  }, [policy, open]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        policy_number: form.policy_number.trim(),
        insurer_name: form.insurer_name.trim(),
        start_date: form.start_date,
        end_date: form.end_date,
        total_limit: Number(form.total_limit) || 0,
        deductible_default: Number(form.deductible_default) || 0,
        annual_premium: Number(form.annual_premium) || 0,
        status: form.status,
      };
      return isEdit ? updatePolicy(policy!.policy_id, payload) : createPolicy(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      onClose();
    },
  });

  const canSubmit =
    form.policy_number.trim() &&
    form.insurer_name.trim() &&
    form.start_date &&
    form.end_date &&
    form.total_limit !== "" &&
    form.deductible_default !== "" &&
    form.annual_premium !== "";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? "עריכת פוליסה" : "פוליסה חדשה"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Grid container spacing={2}>
            <Grid item xs={6}>
              <TextField
                label="מספר פוליסה"
                fullWidth
                value={form.policy_number}
                disabled={isEdit}
                onChange={(e) => setForm((f) => ({ ...f, policy_number: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                label="שם מבטח"
                fullWidth
                value={form.insurer_name}
                onChange={(e) => setForm((f) => ({ ...f, insurer_name: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                label="תחילת תוקף"
                type="date"
                fullWidth
                InputLabelProps={{ shrink: true }}
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                label="סוף תוקף"
                type="date"
                fullWidth
                InputLabelProps={{ shrink: true }}
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
              />
            </Grid>
            <Grid item xs={4}>
              <TextField
                label="תקרת כיסוי (₪)"
                type="number"
                fullWidth
                value={form.total_limit}
                onChange={(e) => setForm((f) => ({ ...f, total_limit: e.target.value }))}
              />
            </Grid>
            <Grid item xs={4}>
              <TextField
                label="השתתפות עצמית (₪)"
                type="number"
                fullWidth
                value={form.deductible_default}
                onChange={(e) => setForm((f) => ({ ...f, deductible_default: e.target.value }))}
              />
            </Grid>
            <Grid item xs={4}>
              <TextField
                label="פרמיה שנתית (₪)"
                type="number"
                fullWidth
                value={form.annual_premium}
                onChange={(e) => setForm((f) => ({ ...f, annual_premium: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                select
                label="סטטוס"
                fullWidth
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as PolicyStatus }))}
              >
                {STATUS_OPTIONS.map((s) => (
                  <MenuItem key={s} value={s}>
                    {POLICY_STATUS_LABELS[s]}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>

          {mutation.isError && (
            <Alert severity="error">
              {isEdit ? "עדכון הפוליסה נכשל." : "יצירת הפוליסה נכשלה — ייתכן שמספר הפוליסה כבר קיים."}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>ביטול</Button>
        <Button
          variant="contained"
          disabled={!canSubmit || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {isEdit ? "שמירה" : "יצירה"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
