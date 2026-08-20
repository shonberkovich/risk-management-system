import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import PeopleAltIcon from "@mui/icons-material/PeopleAlt";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { fetchUsersAdmin, type UserAdmin } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import UserDialog from "../components/UserDialog";
import { formatDateTime, ROLE_LABELS } from "../format";

/** ADMIN-only user management screen (TODO_SPEC.md §5, "ניהול משתמשים והרשאות") — create
 * users, edit their details/role, reset a password, and enable/disable (via UserDialog,
 * which wraps the existing POST/PATCH /api/users endpoints). Listing uses the ADMIN-only
 * GET /api/users/admin (fuller shape) rather than the open GET /api/users used elsewhere
 * as a name/role picker. */
export default function Users() {
  const { user: me } = useAuth();
  const [dialogUser, setDialogUser] = useState<UserAdmin | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const users = useQuery({
    queryKey: ["users-admin"],
    queryFn: fetchUsersAdmin,
    enabled: me?.role === "ADMIN",
  });

  if (me?.role !== "ADMIN") {
    return <Alert severity="error">מסך זה זמין למנהלי מערכת (ADMIN) בלבד.</Alert>;
  }

  const openCreate = () => {
    setDialogUser(null);
    setDialogOpen(true);
  };
  const openEdit = (u: UserAdmin) => {
    setDialogUser(u);
    setDialogOpen(true);
  };

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
        <Stack direction="row" spacing={1} alignItems="center">
          <PeopleAltIcon color="primary" fontSize="large" />
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              ניהול משתמשים
            </Typography>
            <Typography variant="caption" color="text.secondary">
              יצירה, עריכה, שינוי תפקיד והשבתה/הפעלה של משתמשי המערכת.
            </Typography>
          </Box>
        </Stack>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          משתמש חדש
        </Button>
      </Stack>

      {users.isLoading ? (
        <Stack alignItems="center" sx={{ py: 4 }}>
          <CircularProgress size={28} />
        </Stack>
      ) : users.isError ? (
        <Alert severity="error">שגיאה בטעינת רשימת המשתמשים.</Alert>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>שם מלא</TableCell>
              <TableCell>אימייל</TableCell>
              <TableCell>תפקיד</TableCell>
              <TableCell>סטטוס</TableCell>
              <TableCell>נוצר בתאריך</TableCell>
              <TableCell align="left">פעולות</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(users.data ?? []).map((u) => (
              <TableRow key={u.user_id} hover>
                <TableCell>
                  {u.full_name}
                  {u.user_id === me?.user_id && (
                    <Chip label="אני" size="small" variant="outlined" sx={{ marginInlineStart: 1, height: 18 }} />
                  )}
                </TableCell>
                <TableCell sx={{ direction: "ltr", textAlign: "right" }}>{u.email}</TableCell>
                <TableCell>
                  <Chip label={ROLE_LABELS[u.role] ?? u.role} size="small" />
                </TableCell>
                <TableCell>
                  <Chip
                    label={u.is_active ? "פעיל" : "מושבת"}
                    size="small"
                    color={u.is_active ? "success" : "default"}
                  />
                </TableCell>
                <TableCell>{formatDateTime(u.created_at)}</TableCell>
                <TableCell align="left">
                  <Tooltip title="עריכה">
                    <IconButton size="small" onClick={() => openEdit(u)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {(users.data?.length ?? 0) === 0 && !users.isLoading && !users.isError && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
          אין משתמשים במערכת.
        </Typography>
      )}

      <UserDialog open={dialogOpen} user={dialogUser} onClose={() => setDialogOpen(false)} />
    </Stack>
  );
}
