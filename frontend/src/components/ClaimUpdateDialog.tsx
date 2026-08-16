import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { updateClaim, type ClaimStatus, type ClaimTrackingRow } from "../api/client";
import { CLAIM_STATUS_LABELS } from "../format";

const STATUS_OPTIONS: ClaimStatus[] = ["DRAFT", "SUBMITTED", "IN_ADJUSTMENT", "APPROVED", "REJECTED", "SETTLED"];

export default function ClaimUpdateDialog({
  open,
  claim,
  onClose,
}: {
  open: boolean;
  claim: ClaimTrackingRow | null;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<ClaimStatus>("DRAFT");
  const [approvedAmount, setApprovedAmount] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const queryClient = useQueryClient();

  useEffect(() => {
    if (claim) {
      setStatus(claim.claim_status);
      setApprovedAmount(String(claim.approved_amount));
      setExpectedDate(claim.expected_payment_date ? claim.expected_payment_date.slice(0, 10) : "");
    }
  }, [claim, open]);

  const mutation = useMutation({
    mutationFn: () =>
      updateClaim(claim!.claim_id, {
        claim_status: status,
        approved_amount: Number(approvedAmount) || 0,
        expected_payment_date: expectedDate || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["claims"] });
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>עדכון תביעה — {claim?.claim_number}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select label="סטטוס" fullWidth value={status} onChange={(e) => setStatus(e.target.value as ClaimStatus)}>
            {STATUS_OPTIONS.map((s) => (
              <MenuItem key={s} value={s}>
                {CLAIM_STATUS_LABELS[s]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="סכום מאושר (₪)"
            type="number"
            fullWidth
            value={approvedAmount}
            onChange={(e) => setApprovedAmount(e.target.value)}
          />
          <TextField
            label="צפי תאריך תשלום"
            type="date"
            fullWidth
            InputLabelProps={{ shrink: true }}
            value={expectedDate}
            onChange={(e) => setExpectedDate(e.target.value)}
          />
          {mutation.isError && <Alert severity="error">עדכון התביעה נכשל.</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>ביטול</Button>
        <Button variant="contained" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          שמירה
        </Button>
      </DialogActions>
    </Dialog>
  );
}
