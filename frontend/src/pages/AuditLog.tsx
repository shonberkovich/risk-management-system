import HistoryIcon from "@mui/icons-material/History";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TablePagination from "@mui/material/TablePagination";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { fetchAuditLog, fetchAuditLogEntityTypes, type AuditLogEntry } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatDateTime } from "../format";

const ACTION_LABELS: Record<string, string> = { CREATE: "יצירה", UPDATE: "עדכון", DELETE: "מחיקה" };
const ACTION_COLORS: Record<string, "success" | "info" | "error"> = { CREATE: "success", UPDATE: "info", DELETE: "error" };

/** Long JSON request bodies (old/new value) are truncated in the table and shown
 * in full on hover — mirrors the 2000-char truncation the middleware already
 * applies server-side (app/middleware/audit.py), just re-truncated tighter for
 * the grid cell. */
function ValueCell({ value }: { value: string | null }) {
  if (!value) {
    return (
      <Typography variant="caption" color="text.secondary">
        -
      </Typography>
    );
  }
  const preview = value.length > 60 ? `${value.slice(0, 60)}...` : value;
  return (
    <Tooltip title={<Box sx={{ whiteSpace: "pre-wrap", wordBreak: "break-all", maxWidth: 480 }}>{value}</Box>}>
      <Typography
        variant="caption"
        sx={{ fontFamily: "monospace", cursor: "help", direction: "ltr", display: "inline-block" }}
      >
        {preview}
      </Typography>
    </Tooltip>
  );
}

export default function AuditLog() {
  const { user } = useAuth();
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [entityId, setEntityId] = useState("");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const entityTypes = useQuery({ queryKey: ["audit-log", "entity-types"], queryFn: fetchAuditLogEntityTypes });

  const logs = useQuery({
    queryKey: ["audit-log", entityType, action, entityId, page, rowsPerPage],
    queryFn: () =>
      fetchAuditLog({
        entity_type: entityType || undefined,
        action: action || undefined,
        entity_id: entityId ? Number(entityId) : undefined,
        limit: rowsPerPage,
        offset: page * rowsPerPage,
      }),
    enabled: user?.role === "ADMIN",
  });

  if (user?.role !== "ADMIN") {
    return <Alert severity="error">מסך זה זמין למנהלי מערכת (ADMIN) בלבד.</Alert>;
  }

  const resetPage = () => setPage(0);

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} alignItems="center">
        <HistoryIcon color="primary" fontSize="large" />
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            יומן ביקורת (Audit Log)
          </Typography>
          <Typography variant="caption" color="text.secondary">
            תיעוד אוטומטי של כל פעולת יצירה/עדכון/מחיקה במערכת — מי, מה, מתי, וערך קודם/חדש.
          </Typography>
        </Box>
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              select
              label="סוג ישות"
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value);
                resetPage();
              }}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">הכל</MenuItem>
              {(entityTypes.data ?? []).map((t) => (
                <MenuItem key={t} value={t}>
                  {t}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="פעולה"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                resetPage();
              }}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">הכל</MenuItem>
              {Object.entries(ACTION_LABELS).map(([key, label]) => (
                <MenuItem key={key} value={key}>
                  {label}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label="מזהה ישות (entity_id)"
              value={entityId}
              onChange={(e) => {
                setEntityId(e.target.value.replace(/\D/g, ""));
                resetPage();
              }}
              sx={{ minWidth: 180 }}
            />
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          {logs.isLoading ? (
            <Stack alignItems="center" sx={{ py: 4 }}>
              <CircularProgress size={28} />
            </Stack>
          ) : logs.isError ? (
            <Alert severity="error">שגיאה בטעינת יומן הביקורת.</Alert>
          ) : (
            <>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>תאריך ושעה</TableCell>
                    <TableCell>משתמש</TableCell>
                    <TableCell>סוג ישות</TableCell>
                    <TableCell align="left">מזהה</TableCell>
                    <TableCell>פעולה</TableCell>
                    <TableCell>ערך קודם</TableCell>
                    <TableCell>ערך חדש</TableCell>
                    <TableCell>כתובת IP</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(logs.data?.entries ?? []).map((entry: AuditLogEntry) => (
                    <TableRow key={entry.log_id} hover>
                      <TableCell>{formatDateTime(entry.timestamp)}</TableCell>
                      <TableCell>{entry.user_name ?? (entry.user_id ? `#${entry.user_id}` : "לא מזוהה")}</TableCell>
                      <TableCell>{entry.entity_type}</TableCell>
                      <TableCell align="left">{entry.entity_id || "-"}</TableCell>
                      <TableCell>
                        <Chip
                          label={ACTION_LABELS[entry.action] ?? entry.action}
                          size="small"
                          color={ACTION_COLORS[entry.action] ?? "default"}
                        />
                      </TableCell>
                      <TableCell>
                        <ValueCell value={entry.old_value} />
                      </TableCell>
                      <TableCell>
                        <ValueCell value={entry.new_value} />
                      </TableCell>
                      <TableCell sx={{ direction: "ltr" }}>{entry.ip_address ?? "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {(logs.data?.entries.length ?? 0) === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
                  לא נמצאו רשומות התואמות את הסינון הנבחר.
                </Typography>
              )}

              <TablePagination
                component="div"
                count={logs.data?.total ?? 0}
                page={page}
                onPageChange={(_, newPage) => setPage(newPage)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(e) => {
                  setRowsPerPage(Number(e.target.value));
                  resetPage();
                }}
                rowsPerPageOptions={[10, 25, 50, 100]}
                labelRowsPerPage="שורות בעמוד"
                labelDisplayedRows={({ from, to, count }) => `${from}–${to} מתוך ${count}`}
              />
            </>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}
