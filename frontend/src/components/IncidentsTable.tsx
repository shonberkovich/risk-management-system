import GavelIcon from "@mui/icons-material/Gavel";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SendIcon from "@mui/icons-material/Send";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import VisibilityIcon from "@mui/icons-material/Visibility";
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
import { useNavigate } from "react-router-dom";

import type { Incident } from "../api/client";
import { HAZARD_LABELS, INCIDENT_STATUS_LABELS, SEVERITY_COLORS, SEVERITY_LABELS, formatDate, formatIls } from "../format";
import { DATA_TABLE_SX, NAME_CELL_SX, WRAP_CELL_CLASS } from "./responsiveTable";

const STATUS_COLOR: Record<string, "default" | "warning" | "success" | "error" | "info"> = {
  NEW: "info",
  UNDER_INVESTIGATION: "warning",
  CLAIM_FILED: "default",
  CLOSED: "success",
};

export default function IncidentsTable({
  rows,
  propertyNames,
  onInvestigate,
  onClose,
  onFileClaim,
  onSubmitDraft,
}: {
  rows: Incident[];
  propertyNames: Record<number, string>;
  // Optional — same "pass undefined to hide the action" convention as ClaimsTable.tsx.
  // onInvestigate/onClose gate on backend's incidents.py _STATUS_WRITE_ROLES; onFileClaim
  // gates separately on claims.py's _CLAIMS_WRITE_ROLES — two different role sets, so each
  // caller decides its own visibility rather than one shared canWrite flag.
  onInvestigate?: (incident: Incident) => void;
  onClose?: (incident: Incident) => void;
  onFileClaim?: (incident: Incident) => void;
  // A draft (is_draft) has no workflow until it's submitted — the backend refuses a
  // status change or a claim on it — so a draft row offers only this action.
  onSubmitDraft?: (incident: Incident) => void;
}) {
  const navigate = useNavigate();

  if (rows.length === 0) {
    return (
      <Typography color="text.secondary" variant="body2" sx={{ py: 2 }}>
        לא נמצאו אירועים התואמים את הסינון.
      </Typography>
    );
  }

  return (
    <TableContainer sx={{ maxHeight: 520 }}>
      <Table size="small" stickyHeader sx={DATA_TABLE_SX}>
        <TableHead>
          <TableRow>
            <TableCell>מס' אירוע</TableCell>
            <TableCell>נכס</TableCell>
            <TableCell>סוג נזק</TableCell>
            <TableCell>חומרה</TableCell>
            <TableCell align="left">הערכת נזק</TableCell>
            <TableCell>תאריך</TableCell>
            <TableCell>סטטוס</TableCell>
            <TableCell align="center">פעולות</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((inc) => (
            <TableRow key={inc.incident_id} hover>
              <TableCell>{inc.incident_code}</TableCell>
              <TableCell className={WRAP_CELL_CLASS} sx={NAME_CELL_SX}>
                {propertyNames[inc.property_id] ?? `#${inc.property_id}`}
              </TableCell>
              <TableCell>{HAZARD_LABELS[inc.hazard_type] ?? inc.hazard_type}</TableCell>
              <TableCell>
                <Chip size="small" label={SEVERITY_LABELS[inc.severity_level] ?? inc.severity_level} color={SEVERITY_COLORS[inc.severity_level]} />
              </TableCell>
              <TableCell align="left">{formatIls(inc.initial_estimated_loss)}</TableCell>
              <TableCell>{formatDate(inc.incident_timestamp)}</TableCell>
              <TableCell>
                <Stack direction="row" spacing={0.5}>
                  <Chip size="small" label={INCIDENT_STATUS_LABELS[inc.status] ?? inc.status} color={STATUS_COLOR[inc.status]} />
                  {inc.is_draft && <Chip size="small" variant="outlined" label="טיוטה" />}
                </Stack>
              </TableCell>
              <TableCell align="center">
                <Stack direction="row" spacing={0.5} justifyContent="center">
                  <Tooltip title="תיק אירוע מלא">
                    <IconButton size="small" onClick={() => navigate(`/incidents/${inc.incident_id}`)}>
                      <VisibilityIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {onSubmitDraft && inc.is_draft && (
                    <Tooltip title="הגש טיוטה">
                      <IconButton size="small" onClick={() => onSubmitDraft(inc)}>
                        <SendIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  {onInvestigate && !inc.is_draft && inc.status === "NEW" && (
                    <Tooltip title="העבר לבדיקה">
                      <IconButton size="small" onClick={() => onInvestigate(inc)}>
                        <PlayArrowIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  {onFileClaim && !inc.is_draft && inc.status !== "CLOSED" && (
                    <Tooltip title="פתח תביעה">
                      <IconButton size="small" onClick={() => onFileClaim(inc)}>
                        <GavelIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  {onClose && !inc.is_draft && (inc.status === "NEW" || inc.status === "UNDER_INVESTIGATION") && (
                    <Tooltip title="סגור אירוע (ללא תביעה)">
                      <IconButton size="small" onClick={() => onClose(inc)}>
                        <TaskAltIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
