import BoltIcon from "@mui/icons-material/Bolt";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  checkSeismicActivity,
  fetchIncidents,
  fetchProperties,
  updateIncidentStatus,
  type Incident,
  type IncidentStatus,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import FileClaimDialog from "../components/FileClaimDialog";
import IncidentsTable from "../components/IncidentsTable";
import { INCIDENT_STATUS_LABELS } from "../format";

const STATUS_OPTIONS: IncidentStatus[] = ["NEW", "UNDER_INVESTIGATION", "CLAIM_FILED", "CLOSED"];
// Same RISK_MANAGER/ADMIN set backend/app/routers/incidents.py enforces server-side
// (_SEISMIC_TRIGGER_ROLES) for POST /incidents/check-seismic-activity — mirrored here
// to hide the manual-scan button from roles that would get a 403 anyway.
const SEISMIC_TRIGGER_ROLES = ["RISK_MANAGER", "ADMIN"];
// Same role set backend/app/routers/incidents.py enforces server-side for PATCH
// .../status (_STATUS_WRITE_ROLES) — gates IncidentsTable's investigate/close actions.
const STATUS_WRITE_ROLES = ["RISK_MANAGER", "PROPERTY_MANAGER", "RISK_OFFICER", "ADMIN"];
// Same role set backend/app/routers/claims.py enforces server-side for POST /claims
// (_CLAIMS_WRITE_ROLES) — a *different* set from STATUS_WRITE_ROLES above, so
// "file a claim" gets its own flag rather than reusing canChangeStatus.
const CLAIMS_WRITE_ROLES = ["RISK_MANAGER", "CFO", "ADJUSTER", "ADMIN"];

export default function Incidents() {
  const { user } = useAuth();
  const [status, setStatus] = useState<IncidentStatus | "">("");
  const [claimIncident, setClaimIncident] = useState<Incident | null>(null);
  const queryClient = useQueryClient();
  const canTriggerSeismicScan = !!user && SEISMIC_TRIGGER_ROLES.includes(user.role);
  const canChangeStatus = !!user && STATUS_WRITE_ROLES.includes(user.role);
  const canFileClaim = !!user && CLAIMS_WRITE_ROLES.includes(user.role);

  const incidents = useQuery({ queryKey: ["incidents"], queryFn: () => fetchIncidents() });
  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });

  // Manual stand-in for the GSI (Geological Survey of Israel) seismic-activity cron job
  // that doesn't exist in this course project (TODO_SPEC.md §2) — creates draft incidents
  // for properties felt-locally near a real recent earthquake epicenter.
  const seismicScanMutation = useMutation({
    mutationFn: checkSeismicActivity,
    onSuccess: (createdDrafts) => {
      if (createdDrafts.length > 0) queryClient.invalidateQueries({ queryKey: ["incidents"] });
    },
  });

  const propertyNames = useMemo(() => {
    const map: Record<number, string> = {};
    for (const p of properties.data ?? []) map[p.property_id] = p.name;
    return map;
  }, [properties.data]);

  const rows = useMemo(() => {
    const all = incidents.data ?? [];
    return status ? all.filter((i) => i.status === status) : all;
  }, [incidents.data, status]);

  const summary = useMemo(() => {
    const all = incidents.data ?? [];
    return {
      total: all.length,
      new: all.filter((i) => i.status === "NEW").length,
      underInvestigation: all.filter((i) => i.status === "UNDER_INVESTIGATION").length,
      claimFiled: all.filter((i) => i.status === "CLAIM_FILED").length,
    };
  }, [incidents.data]);

  const statusMutation = useMutation({
    mutationFn: ({ id, newStatus }: { id: number; newStatus: IncidentStatus }) => updateIncidentStatus(id, newStatus),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["incidents"] }),
  });

  if (incidents.isLoading) {
    return (
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          ניהול אירועים וזרימת עבודה
        </Typography>
        {canTriggerSeismicScan && (
          <Button
            variant="outlined"
            color="warning"
            startIcon={seismicScanMutation.isPending ? <CircularProgress size={16} /> : <BoltIcon />}
            disabled={seismicScanMutation.isPending}
            onClick={() => seismicScanMutation.mutate()}
          >
            בצע סריקת רעידות אדמה (GSI)
          </Button>
        )}
      </Stack>

      {seismicScanMutation.isSuccess && (
        <Alert severity={seismicScanMutation.data.length > 0 ? "warning" : "success"}>
          {seismicScanMutation.data.length > 0
            ? `נוצרו ${seismicScanMutation.data.length} טיוטות אירוע חדשות בעקבות פעילות סייסמית שזוהתה.`
            : "לא זוהתה פעילות סייסמית רלוונטית לנכסי החברה."}
        </Alert>
      )}
      {seismicScanMutation.isError && <Alert severity="error">סריקת הרעידות נכשלה. נסו שוב.</Alert>}

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ height: "100%", borderTop: "4px solid #1e5b8a" }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    סה"כ אירועים
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800 }}>
                    {summary.total}
                  </Typography>
                </Stack>
                <ReportProblemIcon color="primary" fontSize="large" />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ height: "100%", borderTop: "4px solid #c62828" }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    חדשים (טרם טופלו)
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800 }}>
                    {summary.new}
                  </Typography>
                </Stack>
                <WarningAmberIcon color="error" fontSize="large" />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ height: "100%", borderTop: "4px solid #e69413" }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    בבדיקה
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800 }}>
                    {summary.underInvestigation}
                  </Typography>
                </Stack>
                <PlayArrowIcon color="warning" fontSize="large" />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ height: "100%", borderTop: "4px solid #2e7d32" }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    תביעה הוגשה
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800 }}>
                    {summary.claimFiled}
                  </Typography>
                </Stack>
                <TaskAltIcon color="success" fontSize="large" />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              רשימת אירועים ({rows.length})
            </Typography>
            <TextField
              select
              size="small"
              label="סטטוס"
              value={status}
              onChange={(e) => setStatus(e.target.value as IncidentStatus | "")}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">הכל</MenuItem>
              {STATUS_OPTIONS.map((s) => (
                <MenuItem key={s} value={s}>
                  {INCIDENT_STATUS_LABELS[s]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <IncidentsTable
            rows={rows}
            propertyNames={propertyNames}
            onInvestigate={
              canChangeStatus
                ? (inc) => statusMutation.mutate({ id: inc.incident_id, newStatus: "UNDER_INVESTIGATION" })
                : undefined
            }
            onClose={
              canChangeStatus ? (inc) => statusMutation.mutate({ id: inc.incident_id, newStatus: "CLOSED" }) : undefined
            }
            onFileClaim={canFileClaim ? setClaimIncident : undefined}
          />
        </CardContent>
      </Card>

      <FileClaimDialog open={!!claimIncident} incident={claimIncident} onClose={() => setClaimIncident(null)} />
    </Stack>
  );
}
