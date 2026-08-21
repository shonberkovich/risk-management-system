import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { createClaimPayment, fetchClaimPayments, type ClaimTrackingRow, type PaymentType } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PAYMENT_TYPE_LABELS, formatDate, formatIls } from "../format";

const PAYABLE_STATUSES = new Set(["APPROVED", "SETTLED"]);
const PAYMENT_TYPE_OPTIONS: PaymentType[] = ["ADVANCE", "FINAL_SETTLEMENT"];
// Same role set backend/app/routers/claims.py enforces server-side for POST
// /claims/{id}/payments (_CLAIMS_WRITE_ROLES) — this dialog itself is reachable by
// every role (viewing payments is public, matching the backend's public GET), so the
// "add payment" form specifically needs its own gate rather than relying on the
// caller never opening the dialog at all.
const CLAIMS_WRITE_ROLES = ["RISK_MANAGER", "CFO", "ADJUSTER", "ADMIN"];

export default function ClaimPaymentsDialog({
  open,
  claim,
  onClose,
}: {
  open: boolean;
  claim: ClaimTrackingRow | null;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const canWrite = !!user && CLAIMS_WRITE_ROLES.includes(user.role);
  const [paymentDate, setPaymentDate] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [paymentType, setPaymentType] = useState<PaymentType>("ADVANCE");
  const queryClient = useQueryClient();

  const payments = useQuery({
    queryKey: ["claim-payments", claim?.claim_id],
    queryFn: () => fetchClaimPayments(claim!.claim_id),
    enabled: open && !!claim,
  });

  const paid = (payments.data ?? []).reduce((sum, p) => sum + p.amount, 0);
  const remaining = (claim?.approved_amount ?? 0) - paid;
  const canPay = canWrite && !!claim && PAYABLE_STATUSES.has(claim.claim_status) && remaining > 0;

  const mutation = useMutation({
    mutationFn: () =>
      createClaimPayment(claim!.claim_id, {
        payment_date: paymentDate,
        amount: Number(amount) || 0,
        reference_number: reference || null,
        payment_type: paymentType,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["claim-payments", claim?.claim_id] });
      queryClient.invalidateQueries({ queryKey: ["claims"] });
      setPaymentDate("");
      setAmount("");
      setReference("");
      setPaymentType("ADVANCE");
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>רזרבות ותשלומים — {claim?.claim_number}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction="row" spacing={3}>
            <Stack>
              <Typography variant="caption" color="text.secondary">
                סכום מאושר
              </Typography>
              <Typography sx={{ fontWeight: 700 }}>{formatIls(claim?.approved_amount ?? 0)}</Typography>
            </Stack>
            <Stack>
              <Typography variant="caption" color="text.secondary">
                שולם עד כה
              </Typography>
              <Typography sx={{ fontWeight: 700 }}>{formatIls(paid)}</Typography>
            </Stack>
            <Stack>
              <Typography variant="caption" color="text.secondary">
                יתרה לתשלום
              </Typography>
              <Typography sx={{ fontWeight: 700 }}>{formatIls(Math.max(remaining, 0))}</Typography>
            </Stack>
          </Stack>

          {payments.isLoading ? (
            <CircularProgress size={24} />
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>תאריך</TableCell>
                  <TableCell>סוג</TableCell>
                  <TableCell align="left">סכום</TableCell>
                  <TableCell>אסמכתא</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(payments.data ?? []).map((p) => (
                  <TableRow key={p.payment_id}>
                    <TableCell>{formatDate(p.payment_date)}</TableCell>
                    <TableCell>{PAYMENT_TYPE_LABELS[p.payment_type] ?? p.payment_type}</TableCell>
                    <TableCell align="left">{formatIls(p.amount)}</TableCell>
                    <TableCell>{p.reference_number ?? "-"}</TableCell>
                  </TableRow>
                ))}
                {(payments.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography variant="body2" color="text.secondary">
                        טרם נרשמו תשלומים לתביעה זו.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          {canPay ? (
            <>
              <Divider />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                רישום תשלום חדש
              </Typography>
              <Stack direction="row" spacing={2}>
                <TextField
                  label="תאריך תשלום"
                  type="date"
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
                <TextField
                  label="סכום (₪)"
                  type="number"
                  fullWidth
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Stack>
              <Stack direction="row" spacing={2}>
                <TextField
                  select
                  label="סוג תשלום"
                  fullWidth
                  value={paymentType}
                  onChange={(e) => setPaymentType(e.target.value as PaymentType)}
                >
                  {PAYMENT_TYPE_OPTIONS.map((t) => (
                    <MenuItem key={t} value={t}>
                      {PAYMENT_TYPE_LABELS[t]}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField label="מס' אסמכתא" fullWidth value={reference} onChange={(e) => setReference(e.target.value)} />
              </Stack>
              {mutation.isError && <Alert severity="error">רישום התשלום נכשל.</Alert>}
              <Button
                variant="contained"
                disabled={mutation.isPending || !paymentDate || !amount}
                onClick={() => mutation.mutate()}
              >
                הוספת תשלום
              </Button>
            </>
          ) : !canWrite ? (
            <Alert severity="info">אין לך הרשאה לרשום תשלומים לתביעות.</Alert>
          ) : (
            <Alert severity="info">
              {claim && !PAYABLE_STATUSES.has(claim.claim_status)
                ? "ניתן לרשום תשלום רק לתביעה מאושרת או סגורה."
                : "התביעה שולמה במלואה."}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>סגירה</Button>
      </DialogActions>
    </Dialog>
  );
}
