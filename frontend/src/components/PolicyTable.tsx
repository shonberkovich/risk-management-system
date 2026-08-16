import DomainIcon from "@mui/icons-material/Domain";
import EditIcon from "@mui/icons-material/Edit";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import type { Policy } from "../api/client";
import { POLICY_STATUS_LABELS, formatDate, formatIls } from "../format";

const STATUS_COLOR: Record<string, "default" | "warning" | "success" | "error" | "info"> = {
  ACTIVE: "success",
  PENDING_RENEWAL: "warning",
  EXPIRED: "error",
};

export default function PolicyTable({
  rows,
  onEdit,
  onManageAssets,
}: {
  rows: Policy[];
  onEdit: (policy: Policy) => void;
  onManageAssets: (policy: Policy) => void;
}) {
  if (rows.length === 0) {
    return (
      <Typography color="text.secondary" variant="body2" sx={{ py: 2 }}>
        לא נמצאו פוליסות התואמות את הסינון.
      </Typography>
    );
  }

  return (
    <TableContainer sx={{ maxHeight: 520 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>מספר פוליסה</TableCell>
            <TableCell>מבטח</TableCell>
            <TableCell align="left">תקרת כיסוי</TableCell>
            <TableCell align="left">השתתפות עצמית</TableCell>
            <TableCell align="left">פרמיה שנתית</TableCell>
            <TableCell>תוקף</TableCell>
            <TableCell>סטטוס</TableCell>
            <TableCell align="center">פעולות</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.policy_id} hover>
              <TableCell>{p.policy_number}</TableCell>
              <TableCell>{p.insurer_name}</TableCell>
              <TableCell align="left">{formatIls(p.total_limit)}</TableCell>
              <TableCell align="left">{formatIls(p.deductible_default)}</TableCell>
              <TableCell align="left">{formatIls(p.annual_premium)}</TableCell>
              <TableCell>
                {formatDate(p.start_date)} – {formatDate(p.end_date)}
              </TableCell>
              <TableCell>
                <Chip size="small" label={POLICY_STATUS_LABELS[p.status] ?? p.status} color={STATUS_COLOR[p.status]} />
              </TableCell>
              <TableCell align="center">
                <Stack direction="row" spacing={0.5} justifyContent="center">
                  <Tooltip title="נכסים מבוטחים">
                    <IconButton size="small" onClick={() => onManageAssets(p)}>
                      <DomainIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="עריכת פוליסה">
                    <IconButton size="small" onClick={() => onEdit(p)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
