import FileDownloadIcon from "@mui/icons-material/FileDownload";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { fetchClaims, type ClaimTrackingRow } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import ClaimPaymentsDialog from "../components/ClaimPaymentsDialog";
import ClaimUpdateDialog from "../components/ClaimUpdateDialog";
import ClaimsTable from "../components/ClaimsTable";
import { exportClaimsToExcel } from "../exportClaims";
import { CLAIM_STATUS_LABELS } from "../format";

const STATUS_OPTIONS = ["DRAFT", "SUBMITTED", "IN_ADJUSTMENT", "APPROVED", "REJECTED", "SETTLED"];
// Same role set backend/app/routers/claims.py enforces server-side for PATCH
// /claims/{id} (_CLAIMS_WRITE_ROLES) — gates the table's edit action. Viewing
// payments (onPayments) stays open to every role, matching the backend's public
// GET /claims/{id}/payments; ClaimPaymentsDialog gates *adding* a payment itself.
const CLAIMS_WRITE_ROLES = ["RISK_MANAGER", "CFO", "ADJUSTER", "ADMIN"];

export default function Claims() {
  const { user } = useAuth();
  const canWrite = !!user && CLAIMS_WRITE_ROLES.includes(user.role);
  const [status, setStatus] = useState("");
  const [editClaim, setEditClaim] = useState<ClaimTrackingRow | null>(null);
  const [paymentsClaim, setPaymentsClaim] = useState<ClaimTrackingRow | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["claims", status],
    queryFn: () => fetchClaims(status || undefined),
  });

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          מעקב תביעות וסטטוס גבייה
        </Typography>
        <Stack direction="row" spacing={2}>
          <TextField
            select
            size="small"
            label="סינון לפי סטטוס"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">הכל</MenuItem>
            {STATUS_OPTIONS.map((s) => (
              <MenuItem key={s} value={s}>
                {CLAIM_STATUS_LABELS[s]}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="outlined"
            startIcon={<FileDownloadIcon />}
            disabled={!data || data.length === 0}
            onClick={() => data && exportClaimsToExcel(data, `תביעות-${new Date().toISOString().slice(0, 10)}.xlsx`)}
          >
            ייצוא ל-Excel
          </Button>
        </Stack>
      </Stack>

      <Card variant="outlined">
        <CardContent>
          {isLoading ? (
            <CircularProgress size={24} />
          ) : (
            <ClaimsTable rows={data ?? []} onEdit={canWrite ? setEditClaim : undefined} onPayments={setPaymentsClaim} />
          )}
        </CardContent>
      </Card>

      <ClaimUpdateDialog open={!!editClaim} claim={editClaim} onClose={() => setEditClaim(null)} />
      <ClaimPaymentsDialog open={!!paymentsClaim} claim={paymentsClaim} onClose={() => setPaymentsClaim(null)} />
    </Stack>
  );
}
