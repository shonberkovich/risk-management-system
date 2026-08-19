import AssignmentTurnedInIcon from "@mui/icons-material/AssignmentTurnedIn";
import EditIcon from "@mui/icons-material/Edit";
import InsightsIcon from "@mui/icons-material/Insights";
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

import type { MitigationTask } from "../api/client";
import { MITIGATION_STATUS_LABELS, formatDate, formatIls } from "../format";

const STATUS_COLOR: Record<string, "default" | "warning" | "success" | "error" | "info"> = {
  OPEN: "info",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
  OVERDUE: "error",
};

export interface MitigationRow extends MitigationTask {
  property_name: string;
  assigned_to_name: string | null;
}

export default function MitigationTable({
  rows,
  onEdit,
  onMarkComplete,
  onShowRoi,
}: {
  rows: MitigationRow[];
  onEdit: (task: MitigationRow) => void;
  onMarkComplete: (task: MitigationRow) => void;
  onShowRoi: (task: MitigationRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <Typography color="text.secondary" variant="body2" sx={{ py: 2 }}>
        לא נמצאו משימות התואמות את הסינון.
      </Typography>
    );
  }

  return (
    <TableContainer sx={{ maxHeight: 480 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>כותרת המשימה</TableCell>
            <TableCell>נכס</TableCell>
            <TableCell>גורם מבצע</TableCell>
            <TableCell align="left">עלות משוערת</TableCell>
            <TableCell align="left">חיסכון שנתי צפוי</TableCell>
            <TableCell align="left">ROI</TableCell>
            <TableCell>סטטוס</TableCell>
            <TableCell>תאריך יעד</TableCell>
            <TableCell align="center">פעולות</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((t) => (
            <TableRow key={t.task_id} hover>
              <TableCell>{t.title}</TableCell>
              <TableCell>{t.property_name}</TableCell>
              <TableCell>{t.assigned_to_name ?? <Typography variant="body2" color="text.secondary">לא משויך</Typography>}</TableCell>
              <TableCell align="left">{formatIls(t.cost_estimate)}</TableCell>
              <TableCell align="left">{formatIls(t.expected_annual_savings)}</TableCell>
              <TableCell align="left">{t.roi_percent !== null ? `${t.roi_percent.toFixed(1)}%` : "-"}</TableCell>
              <TableCell>
                <Chip
                  size="small"
                  label={MITIGATION_STATUS_LABELS[t.status] ?? t.status}
                  color={STATUS_COLOR[t.status]}
                />
              </TableCell>
              <TableCell>{formatDate(t.due_date)}</TableCell>
              <TableCell align="center">
                <Stack direction="row" spacing={0.5} justifyContent="center">
                  <Tooltip title="עריכה">
                    <IconButton size="small" onClick={() => onEdit(t)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="פירוט ROI">
                    <IconButton size="small" onClick={() => onShowRoi(t)}>
                      <InsightsIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t.status === "COMPLETED" ? "המשימה כבר הושלמה" : "סימון כבוצע"}>
                    <span>
                      <IconButton size="small" disabled={t.status === "COMPLETED"} onClick={() => onMarkComplete(t)}>
                        <AssignmentTurnedInIcon fontSize="small" />
                      </IconButton>
                    </span>
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
