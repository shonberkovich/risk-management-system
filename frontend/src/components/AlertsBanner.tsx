import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ThunderstormIcon from "@mui/icons-material/Thunderstorm";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Stack from "@mui/material/Stack";

import type { Alert as AlertData, WeatherAlert } from "../api/client";

// Real values from app/integrations/weather.py's _SEVERITIES/_ALERT_TYPES — a separate
// scale from the low/moderate/high/extreme one used for incident severity elsewhere.
const WEATHER_SEVERITY_LABELS: Record<string, string> = { ADVISORY: "מייעצת", WATCH: "מעקב", WARNING: "אזהרה" };
const WEATHER_MUI_SEVERITY: Record<string, "info" | "warning" | "error"> = {
  ADVISORY: "info",
  WATCH: "warning",
  WARNING: "error",
};
const WEATHER_ALERT_TYPE_LABELS: Record<string, string> = {
  STORM: "סופה",
  FLOOD_WARNING: "אזהרת הצפה",
  HEATWAVE: "גל חום",
};

/** Displays threshold-crossing alerts from GET /api/analytics/alerts (geographic
 * exposure concentration, open-incident concentration) plus, optionally, active
 * regional weather alerts from GET /api/integrations/weather/alerts (TODO_SPEC.md §5,
 * "שילוב מזג אוויר") — same banner, same visual language, two different sources.
 * Read-only — no push/SMS, just a visual flag on the dashboard. Renders nothing when
 * there's nothing to show. */
export default function AlertsBanner({
  alerts,
  weatherAlerts = [],
}: {
  alerts: AlertData[];
  weatherAlerts?: WeatherAlert[];
}) {
  if (alerts.length === 0 && weatherAlerts.length === 0) return null;

  return (
    <Stack spacing={1}>
      {alerts.map((alert, idx) => (
        <Alert
          key={`threshold-${idx}`}
          severity={alert.severity === "critical" ? "error" : "warning"}
          icon={alert.severity === "critical" ? <ErrorOutlineIcon /> : <WarningAmberIcon />}
          variant="outlined"
        >
          <AlertTitle sx={{ fontWeight: 700 }}>{alert.title}</AlertTitle>
          {alert.message}
        </Alert>
      ))}
      {weatherAlerts.map((alert) => (
        <Alert
          key={`weather-${alert.property_id}-${alert.issued_at}`}
          severity={WEATHER_MUI_SEVERITY[alert.severity] ?? "warning"}
          icon={<ThunderstormIcon />}
          variant="outlined"
        >
          <AlertTitle sx={{ fontWeight: 700 }}>
            {WEATHER_ALERT_TYPE_LABELS[alert.alert_type] ?? alert.alert_type} — {alert.name}
          </AlertTitle>
          רמת התראה: {WEATHER_SEVERITY_LABELS[alert.severity] ?? alert.severity}
        </Alert>
      ))}
    </Stack>
  );
}
