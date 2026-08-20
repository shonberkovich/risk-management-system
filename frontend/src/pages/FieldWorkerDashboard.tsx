import AddAlertIcon from "@mui/icons-material/AddAlert";
import CircularProgress from "@mui/material/CircularProgress";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import SyncIcon from "@mui/icons-material/Sync";
import WifiIcon from "@mui/icons-material/Wifi";
import WifiOffIcon from "@mui/icons-material/WifiOff";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";

import { fetchIncidents, fetchWeatherAlerts } from "../api/client";
import AlertsBanner from "../components/AlertsBanner";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { subscribeToSyncQueue, trySync } from "../offline/syncQueue";
import {
  HAZARD_LABELS,
  INCIDENT_STATUS_LABELS,
  SEVERITY_COLORS,
  SEVERITY_LABELS,
  formatDateTime,
} from "../format";

const INCIDENT_STATUS_COLOR: Record<string, "default" | "warning" | "success" | "error" | "info"> = {
  NEW: "info",
  UNDER_INVESTIGATION: "warning",
  CLAIM_FILED: "default",
  CLOSED: "success",
};

const RECENT_LIMIT = 12;

/** Reduced-scope dashboard for FIELD_WORKER (TODO_SPEC.md §5, "דשבורד מותאם לשטח") — the
 * executive Dashboard.tsx surfaces portfolio financials (TIV/MFL, cashflow, loss ratio,
 * VaR-adjacent risk matrix) that field workers have no access to server-side (see
 * routers/analytics.py's _FINANCIAL_READ_ROLES, enforced since the RBAC-on-GET task) —
 * loading that page as FIELD_WORKER would just surface a wall of 403s. This shows only
 * what a field worker actually needs on shift: connectivity/offline-sync status and
 * recent incident statuses, plus a shortcut to report a new one. Dashboard.tsx switches
 * to this component for FIELD_WORKER instead of gating the exec dashboard's individual
 * widgets, so there's one obviously-safe screen rather than many conditionally-hidden
 * pieces of a screen that was designed for a different audience. */
export default function FieldWorkerDashboard() {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const navigate = useNavigate();

  useEffect(
    () =>
      subscribeToSyncQueue((state) => {
        setPendingCount(state.pendingCount);
        setSyncing(state.syncing);
      }),
    [],
  );

  const incidents = useQuery({ queryKey: ["incidents", "all"], queryFn: () => fetchIncidents() });
  const recent = (incidents.data ?? []).slice(0, RECENT_LIMIT);
  // Weather is open to every authenticated role server-side — a field worker on-site
  // needs a storm/flood warning as much as (if not more than) a risk officer does
  // (TODO_SPEC.md §5, "שילוב מזג אוויר").
  const weatherAlerts = useQuery({ queryKey: ["weather-alerts"], queryFn: () => fetchWeatherAlerts() });

  return (
    <Stack spacing={3}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        דשבורד שטח
      </Typography>

      {weatherAlerts.data && <AlertsBanner alerts={[]} weatherAlerts={weatherAlerts.data} />}

      <Card
        variant="outlined"
        sx={{ bgcolor: (theme) => alpha(online ? theme.palette.success.main : theme.palette.warning.main, 0.08) }}
      >
        <CardContent>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }} justifyContent="space-between">
            <Stack direction="row" spacing={1.5} alignItems="center">
              {online ? <WifiIcon color="success" fontSize="large" /> : <WifiOffIcon color="warning" fontSize="large" />}
              <Box>
                <Typography sx={{ fontWeight: 700 }}>{online ? "מחובר לרשת" : "לא מקוון"}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {pendingCount === 0
                    ? "אין דיווחים ממתינים לסנכרון."
                    : `${pendingCount} דיווחים ממתינים לסנכרון${online ? "" : " — יסונכרנו אוטומטית כשהחיבור יחזור"}.`}
                </Typography>
              </Box>
            </Stack>
            {pendingCount > 0 && online && (
              <Button
                variant="outlined"
                startIcon={syncing ? <CircularProgress size={16} /> : <SyncIcon />}
                disabled={syncing}
                onClick={() => trySync()}
              >
                {syncing ? "מסנכרן..." : "סנכרון עכשיו"}
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Button
        variant="contained"
        size="large"
        startIcon={<AddAlertIcon />}
        onClick={() => navigate("/report-incident")}
        sx={{ alignSelf: "flex-start", py: 1.5, px: 3 }}
      >
        דיווח אירוע חדש
      </Button>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
            <ReportProblemIcon fontSize="small" sx={{ verticalAlign: "middle", marginInlineEnd: 0.5 }} />
            אירועים אחרונים
          </Typography>

          {incidents.isLoading ? (
            <Stack alignItems="center" sx={{ py: 3 }}>
              <CircularProgress size={24} />
            </Stack>
          ) : incidents.isError ? (
            <Alert severity="error">שגיאה בטעינת רשימת האירועים.</Alert>
          ) : recent.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              לא דווחו אירועים עדיין.
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {recent.map((i) => (
                <Stack
                  key={i.incident_id}
                  component={RouterLink}
                  to={`/incidents/${i.incident_id}`}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                  sx={{
                    p: 1,
                    borderRadius: 1,
                    textDecoration: "none",
                    color: "inherit",
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 110 }}>
                    {i.incident_code}
                  </Typography>
                  <Chip size="small" label={INCIDENT_STATUS_LABELS[i.status] ?? i.status} color={INCIDENT_STATUS_COLOR[i.status]} />
                  <Chip size="small" label={SEVERITY_LABELS[i.severity_level] ?? i.severity_level} color={SEVERITY_COLORS[i.severity_level]} />
                  <Chip size="small" variant="outlined" label={HAZARD_LABELS[i.hazard_type] ?? i.hazard_type} />
                  {i.is_draft && <Chip size="small" variant="outlined" color="default" label="טיוטה" />}
                  <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1, textAlign: "left" }}>
                    {formatDateTime(i.incident_timestamp)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}
