import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Stack from "@mui/material/Stack";

import type { Alert as AlertData } from "../api/client";

/** Displays threshold-crossing alerts from GET /api/analytics/alerts (geographic
 * exposure concentration, open-incident concentration). Read-only — no push/SMS,
 * just a visual flag on the dashboard. Renders nothing when there are no alerts. */
export default function AlertsBanner({ alerts }: { alerts: AlertData[] }) {
  if (alerts.length === 0) return null;

  return (
    <Stack spacing={1}>
      {alerts.map((alert, idx) => (
        <Alert
          key={idx}
          severity={alert.severity === "critical" ? "error" : "warning"}
          icon={alert.severity === "critical" ? <ErrorOutlineIcon /> : <WarningAmberIcon />}
          variant="outlined"
        >
          <AlertTitle sx={{ fontWeight: 700 }}>{alert.title}</AlertTitle>
          {alert.message}
        </Alert>
      ))}
    </Stack>
  );
}
