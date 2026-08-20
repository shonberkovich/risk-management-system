import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { deleteRolePermission, fetchRolePermissions, type RolePermission } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import RolePermissionDialog from "../components/RolePermissionDialog";
import { ROLE_LABELS } from "../format";

const ROLE_OPTIONS = Object.keys(ROLE_LABELS);

/** ADMIN-only screen for the Role_Permissions catalog (TODO_SPEC.md §5, "ניהול משתמשים
 * והרשאות" / §2 "ניהול Role_Permissions"). This edits the *documented* permission catalog
 * (role → permission_key → description) — it is reference/descriptive data, not the live
 * enforcement mechanism; every router still gates writes with hardcoded require_roles(...)
 * tuples regardless of what's edited here (see backend/app/routers/role_permissions.py's
 * module docstring for the full rationale). */
export default function Roles() {
  const { user: me } = useAuth();
  const [roleFilter, setRoleFilter] = useState("");
  const [dialogPermission, setDialogPermission] = useState<RolePermission | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const permissions = useQuery({
    queryKey: ["role-permissions", roleFilter],
    queryFn: () => fetchRolePermissions(roleFilter || undefined),
    enabled: me?.role === "ADMIN",
  });

  const removeMutation = useMutation({
    mutationFn: deleteRolePermission,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["role-permissions"] }),
  });

  if (me?.role !== "ADMIN") {
    return <Alert severity="error">מסך זה זמין למנהלי מערכת (ADMIN) בלבד.</Alert>;
  }

  const openCreate = () => {
    setDialogPermission(null);
    setDialogOpen(true);
  };
  const openEdit = (p: RolePermission) => {
    setDialogPermission(p);
    setDialogOpen(true);
  };

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
        <Stack direction="row" spacing={1} alignItems="center">
          <VerifiedUserIcon color="primary" fontSize="large" />
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              ניהול הרשאות (Role Permissions)
            </Typography>
            <Typography variant="caption" color="text.secondary">
              קטלוג ההרשאות המתועדות לכל תפקיד. לתשומת לב: אכיפת ההרשאות בפועל בכל endpoint
              נעשית בקוד השרת (require_roles), לא נגזרת אוטומטית מהקטלוג הזה.
            </Typography>
          </Box>
        </Stack>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          הרשאה חדשה
        </Button>
      </Stack>

      <TextField
        select
        label="סינון לפי תפקיד"
        value={roleFilter}
        onChange={(e) => setRoleFilter(e.target.value)}
        sx={{ minWidth: 220 }}
      >
        <MenuItem value="">כל התפקידים</MenuItem>
        {ROLE_OPTIONS.map((r) => (
          <MenuItem key={r} value={r}>
            {ROLE_LABELS[r]}
          </MenuItem>
        ))}
      </TextField>

      {permissions.isLoading ? (
        <Stack alignItems="center" sx={{ py: 4 }}>
          <CircularProgress size={28} />
        </Stack>
      ) : permissions.isError ? (
        <Alert severity="error">שגיאה בטעינת קטלוג ההרשאות.</Alert>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>תפקיד</TableCell>
              <TableCell>מפתח הרשאה</TableCell>
              <TableCell>תיאור</TableCell>
              <TableCell align="left">פעולות</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(permissions.data ?? []).map((p) => (
              <TableRow key={p.role_permission_id} hover>
                <TableCell>
                  <Chip label={ROLE_LABELS[p.role] ?? p.role} size="small" />
                </TableCell>
                <TableCell sx={{ fontFamily: "monospace", direction: "ltr", textAlign: "right" }}>
                  {p.permission_key}
                </TableCell>
                <TableCell>{p.description || "-"}</TableCell>
                <TableCell align="left">
                  <Tooltip title="עריכה">
                    <IconButton size="small" onClick={() => openEdit(p)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="מחיקה">
                    <IconButton
                      size="small"
                      disabled={removeMutation.isPending}
                      onClick={() => {
                        if (window.confirm(`למחוק את ההרשאה "${p.permission_key}" עבור ${ROLE_LABELS[p.role] ?? p.role}?`)) {
                          removeMutation.mutate(p.role_permission_id);
                        }
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {(permissions.data?.length ?? 0) === 0 && !permissions.isLoading && !permissions.isError && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
          לא נמצאו הרשאות תואמות.
        </Typography>
      )}

      {removeMutation.isError && <Alert severity="error">מחיקת ההרשאה נכשלה.</Alert>}

      <RolePermissionDialog open={dialogOpen} permission={dialogPermission} onClose={() => setDialogOpen(false)} />
    </Stack>
  );
}
