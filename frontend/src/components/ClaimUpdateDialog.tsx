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
import { apiErrorMessage } from "../api/errors";
import { CLAIM_STATUS_LABELS, claimStatusOptions } from "../format";

const FIELD_LABELS = { approved_amount: "סכום מאושר", expected_payment_date: "צפי תאריך תשלום" };

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

  const mutation = useMutation({
    mutationFn: () =>
      updateClaim(claim!.claim_id, {
        claim_status: status,
        approved_amount: Number(approvedAmount),
        expected_payment_date: expectedDate || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["claims"] });
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
      onClose();
    },
  });

  useEffect(() => {
    mutation.reset(); // the previous claim's error doesn't belong to this opening
    if (claim) {
      setStatus(claim.claim_status);
      setApprovedAmount(String(claim.approved_amount));
      setExpectedDate(claim.expected_payment_date ? claim.expected_payment_date.slice(0, 10) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on (re)open only
  }, [claim, open]);

  // The same bounds routers/claims.py update_claim enforces (it also checks the
  // policy's limit, which this row doesn't carry).
  const approved = Number(approvedAmount);
  const paid = claim?.paid_amount ?? 0;
  const approvedError =
    approvedAmount.trim() === "" || !Number.isFinite(approved) || approved < 0
      ? "יש להזין סכום אפס ומעלה"
      : claim && approved > claim.claimed_amount
        ? "הסכום המאושר לא יכול לעלות על הסכום הנתבע"
        : approved < paid
          ? "הסכום המאושר לא יכול להיות נמוך מהסכום ששולם עד כה"
          : (status === "APPROVED" || status === "SETTLED") && approved <= 0
            ? "יש להזין סכום מאושר לפני אישור או סגירה של התביעה"
            : null;
  const statusOptions = claim ? claimStatusOptions(claim.claim_status, paid) : [];

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>עדכון תביעה — {claim?.claim_number}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="סטטוס"
            fullWidth
            value={status}
            onChange={(e) => setStatus(e.target.value as ClaimStatus)}
            helperText="תביעה מתקדמת רק קדימה; ״נסגרה״ אחרי ״אושרה״"
          >
            {statusOptions.map((s) => (
              <MenuItem key={s} value={s}>
                {CLAIM_STATUS_LABELS[s]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="סכום מאושר (₪)"
            type="number"
            fullWidth
            inputProps={{ min: 0, max: claim?.claimed_amount }}
            error={!!approvedError}
            helperText={approvedError ?? undefined}
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
          {mutation.isError && (
            <Alert severity="error">{apiErrorMessage(mutation.error, "עדכון התביעה נכשל.", FIELD_LABELS)}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>ביטול</Button>
        <Button variant="contained" disabled={!!approvedError || mutation.isPending} onClick={() => mutation.mutate()}>
          שמירה
        </Button>
      </DialogActions>
    </Dialog>
  );
}
