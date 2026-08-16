import EditIcon from "@mui/icons-material/Edit";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import type { ClaimTrackingRow } from "../api/client";
import { CLAIM_STATUS_LABELS, HAZARD_LABELS, formatDate, formatIls } from "../format";

const STATUS_COLOR: Record<string, "default" | "warning" | "success" | "error" | "info"> = {
  DRAFT: "default",
  SUBMITTED: "info",
  IN_ADJUSTMENT: "warning",
  APPROVED: "success",
  REJECTED: "error",
  SETTLED: "default",
};

const TERMINAL_STATUSES = new Set(["SETTLED", "REJECTED"]);

export default function ClaimsTable({
  rows,
  onEdit,
}: {
  rows: ClaimTrackingRow[];
  onEdit?: (claim: ClaimTrackingRow) => void;
}) {
  const totals = rows.reduce(
    (acc, r) => ({
      claimed: acc.claimed + r.claimed_amount,
      deductible: acc.deductible + r.deductible_applied,
      approved: acc.approved + r.approved_amount,
    }),
    { claimed: 0, deductible: 0, approved: 0 },
  );

  return (
    <TableContainer sx={{ maxHeight: 360 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>מס' תביעה</TableCell>
            <TableCell>נכס</TableCell>
            <TableCell>סוג נזק</TableCell>
            <TableCell align="left">סכום נתבע</TableCell>
            <TableCell align="left">השתתפות עצמית</TableCell>
            <TableCell align="left">סכום מאושר</TableCell>
            <TableCell>סטטוס</TableCell>
            <TableCell>צפי תשלום</TableCell>
            {onEdit && <TableCell align="center">פעולות</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.claim_id} hover>
              <TableCell>{r.claim_number}</TableCell>
              <TableCell>{r.property_name}</TableCell>
              <TableCell>{HAZARD_LABELS[r.hazard_type] ?? r.hazard_type}</TableCell>
              <TableCell align="left">{formatIls(r.claimed_amount)}</TableCell>
              <TableCell align="left">{formatIls(r.deductible_applied)}</TableCell>
              <TableCell align="left">{formatIls(r.approved_amount)}</TableCell>
              <TableCell>
                <Chip size="small" label={CLAIM_STATUS_LABELS[r.claim_status] ?? r.claim_status} color={STATUS_COLOR[r.claim_status]} />
              </TableCell>
              <TableCell>{r.expected_payment_date ? formatDate(r.expected_payment_date) : "-"}</TableCell>
              {onEdit && (
                <TableCell align="center">
                  <Tooltip title={TERMINAL_STATUSES.has(r.claim_status) ? "תביעה סגורה" : "עדכון תביעה"}>
                    <span>
                      <IconButton size="small" disabled={TERMINAL_STATUSES.has(r.claim_status)} onClick={() => onEdit(r)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
              )}
            </TableRow>
          ))}
          <TableRow sx={{ bgcolor: "action.hover" }}>
            <TableCell colSpan={3}>
              <Typography sx={{ fontWeight: 700 }}>סה"כ</Typography>
            </TableCell>
            <TableCell align="left" sx={{ fontWeight: 700 }}>{formatIls(totals.claimed)}</TableCell>
            <TableCell align="left" sx={{ fontWeight: 700 }}>{formatIls(totals.deductible)}</TableCell>
            <TableCell align="left" sx={{ fontWeight: 700 }}>{formatIls(totals.approved)}</TableCell>
            <TableCell colSpan={onEdit ? 3 : 2} />
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
  );
}
