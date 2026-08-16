import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { createClaim, fetchEligiblePolicies, type Incident } from "../api/client";

export default function FileClaimDialog({
  open,
  incident,
  onClose,
}: {
  open: boolean;
  incident: Incident | null;
  onClose: () => void;
}) {
  const [policyId, setPolicyId] = useState<number | "">("");
  const [claimedAmount, setClaimedAmount] = useState("");
  const [deductible, setDeductible] = useState("");
  const [adjusterName, setAdjusterName] = useState("");
  const queryClient = useQueryClient();

  const policies = useQuery({
    queryKey: ["eligible-policies", incident?.incident_id],
    queryFn: () => fetchEligiblePolicies(incident!.incident_id),
    enabled: open && !!incident,
  });

  useEffect(() => {
    if (open && incident) {
      setPolicyId("");
      setClaimedAmount(String(incident.initial_estimated_loss));
      setDeductible("");
      setAdjusterName("");
    }
  }, [open, incident]);

  const mutation = useMutation({
    mutationFn: () =>
      createClaim({
        incident_id: incident!.incident_id,
        policy_id: Number(policyId),
        claimed_amount: Number(claimedAmount) || 0,
        deductible_applied: Number(deductible) || 0,
        adjuster_name: adjusterName.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
      queryClient.invalidateQueries({ queryKey: ["claims"] });
      onClose();
    },
  });

  const canSubmit = !!policyId && Number(claimedAmount) > 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>פתיחת תביעה — {incident?.incident_code}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {policies.isLoading ? (
            <CircularProgress size={24} />
          ) : (policies.data ?? []).length === 0 ? (
            <Alert severity="warning">לא נמצאה פוליסה פעילה המכסה את הנכס הזה.</Alert>
          ) : (
            <TextField
              select
              label="פוליסה מכסה"
              fullWidth
              value={policyId}
              onChange={(e) => setPolicyId(Number(e.target.value))}
            >
              {(policies.data ?? []).map((p) => (
                <MenuItem key={p.policy_id} value={p.policy_id}>
                  {p.policy_number} — {p.insurer_name}
                </MenuItem>
              ))}
            </TextField>
          )}

          <Grid container spacing={2}>
            <Grid item xs={6}>
              <TextField
                label="סכום נתבע (₪)"
                type="number"
                fullWidth
                value={claimedAmount}
                onChange={(e) => setClaimedAmount(e.target.value)}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                label="השתתפות עצמית (₪)"
                type="number"
                fullWidth
                value={deductible}
                onChange={(e) => setDeductible(e.target.value)}
              />
            </Grid>
          </Grid>
          <TextField
            label="שם שמאי (אופציונלי)"
            fullWidth
            value={adjusterName}
            onChange={(e) => setAdjusterName(e.target.value)}
          />

          {mutation.isError && <Alert severity="error">פתיחת התביעה נכשלה.</Alert>}
          <Typography variant="caption" color="text.secondary">
            פתיחת תביעה תעדכן אוטומטית את סטטוס האירוע ל"תביעה הוגשה".
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>ביטול</Button>
        <Button variant="contained" disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
          פתח תביעה
        </Button>
      </DialogActions>
    </Dialog>
  );
}
