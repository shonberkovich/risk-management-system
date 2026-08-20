import CloudSyncIcon from "@mui/icons-material/CloudSync";
import PublicIcon from "@mui/icons-material/Public";
import RefreshIcon from "@mui/icons-material/Refresh";
import ThunderstormIcon from "@mui/icons-material/Thunderstorm";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchEconomicIndexSeries,
  fetchErpBookValues,
  fetchGisRiskLayers,
  fetchReplacementValueUpdates,
  fetchWeatherAlerts,
  postErpClaimReceipts,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatDate, formatDateTime, formatIls, formatIlsCompact, formatPercent } from "../format";

const ERP_ROLES = ["RISK_MANAGER", "CFO", "ADMIN"];
const GIS_ROLES = ["RISK_MANAGER", "RISK_OFFICER", "ADMIN"];
const ECONOMICS_ROLES = ["RISK_MANAGER", "CFO", "ADMIN"];
// Weather is open to every authenticated role server-side (routers/integrations.py) — a
// field worker at a property needs the warning as much as a risk officer does.

// Real values from app/integrations/weather.py's _SEVERITIES/_ALERT_TYPES — not the
// low/moderate/high/extreme scale used elsewhere in the app for incident severity.
const WEATHER_SEVERITY_LABELS: Record<string, string> = { ADVISORY: "מייעצת", WATCH: "מעקב", WARNING: "אזהרה" };
const WEATHER_SEVERITY_COLOR: Record<string, "info" | "warning" | "error" | "default"> = {
  ADVISORY: "info",
  WATCH: "warning",
  WARNING: "error",
};
const WEATHER_ALERT_TYPE_LABELS: Record<string, string> = {
  STORM: "סופה",
  FLOOD_WARNING: "אזהרת הצפה",
  HEATWAVE: "גל חום",
};

function SectionHeader({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        {icon}
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        </Box>
      </Stack>
      {action}
    </Stack>
  );
}

/** TODO_SPEC.md §5, "מסכי אינטגרציה והתראות" — read-only views + manual "sync" triggers over
 * the four simulated external integrations already implemented in app/integrations/*.py
 * (ERP, GIS, weather, economics/CPI). Every one of these is explicitly simulated server-side
 * (no real external call, nothing written back to Properties/Claims) — see each router
 * endpoint's docstring in routers/integrations.py — so "sync" here just means re-fetching the
 * simulated feed, and ERP's "post claim receipts" builds journal-entry-shaped rows without an
 * idempotency flag (calling it again re-posts the same still-open receipts, same as the API). */
export default function Integrations() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canReadErp = !!user && ERP_ROLES.includes(user.role);
  const canReadGis = !!user && GIS_ROLES.includes(user.role);
  const canReadEconomics = !!user && ECONOMICS_ROLES.includes(user.role);

  const erpBookValues = useQuery({ queryKey: ["erp-book-values"], queryFn: fetchErpBookValues, enabled: canReadErp });
  const gisLayers = useQuery({ queryKey: ["gis-risk-layers"], queryFn: fetchGisRiskLayers, enabled: canReadGis });
  const weatherAlerts = useQuery({ queryKey: ["weather-alerts"], queryFn: () => fetchWeatherAlerts() });
  const economicIndex = useQuery({
    queryKey: ["economic-index-series"],
    queryFn: fetchEconomicIndexSeries,
    enabled: canReadEconomics,
  });
  const replacementUpdates = useQuery({
    queryKey: ["replacement-value-updates"],
    queryFn: () => fetchReplacementValueUpdates(),
    enabled: canReadEconomics,
  });

  const postReceiptsMutation = useMutation({
    mutationFn: postErpClaimReceipts,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["erp-claim-receipts"] }),
  });

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} alignItems="center">
        <CloudSyncIcon color="primary" fontSize="large" />
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            אינטגרציות
          </Typography>
          <Typography variant="caption" color="text.secondary">
            צפייה וסנכרון ידני מול מערכות חיצוניות מדומות: ERP (ערכים בספרים), GIS (שכבות סיכון), מזג אוויר, ומדדים כלכליים.
          </Typography>
        </Box>
      </Stack>

      {canReadErp && (
        <Card variant="outlined">
          <CardContent>
            <SectionHeader
              icon={<CloudSyncIcon color="action" />}
              title={`ERP — ערכים בספרים (${erpBookValues.data?.length ?? 0})`}
              subtitle="ייבוא מדומה של ערכי נכסים מה-ERP הארגוני, לצד רישום קבלות תביעות כתנועות יומן."
              action={
                <Stack direction="row" spacing={1}>
                  <Button size="small" startIcon={<RefreshIcon />} onClick={() => erpBookValues.refetch()} disabled={erpBookValues.isFetching}>
                    רענון
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={postReceiptsMutation.isPending}
                    onClick={() => postReceiptsMutation.mutate()}
                  >
                    רישום קבלות תביעות
                  </Button>
                </Stack>
              }
            />

            {postReceiptsMutation.isSuccess && (
              <Alert severity="success" sx={{ mb: 1.5 }}>
                נרשמו {postReceiptsMutation.data.length} תנועות קבלת תביעה ביומן ה-ERP (מדומה).
              </Alert>
            )}
            {postReceiptsMutation.isError && (
              <Alert severity="error" sx={{ mb: 1.5 }}>
                רישום התנועות נכשל.
              </Alert>
            )}

            {erpBookValues.isLoading ? (
              <CircularProgress size={20} />
            ) : (
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>נכס</TableCell>
                      <TableCell align="left">ערך בספרים (מקומי)</TableCell>
                      <TableCell align="left">שווי כינון</TableCell>
                      <TableCell>נכון לתאריך</TableCell>
                      <TableCell>מקור</TableCell>
                      <TableCell>סטטוס</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(erpBookValues.data ?? []).map((row) => (
                      <TableRow key={row.property_id} hover>
                        <TableCell>
                          {row.name} <Typography component="span" variant="caption" color="text.secondary">({row.property_code})</Typography>
                        </TableCell>
                        <TableCell align="left">{formatIlsCompact(row.book_value)}</TableCell>
                        <TableCell align="left">{formatIlsCompact(row.replacement_value)}</TableCell>
                        <TableCell>{formatDate(row.as_of)}</TableCell>
                        <TableCell>{row.source_system}</TableCell>
                        <TableCell>
                          <Chip size="small" label={row.status} variant="outlined" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      {canReadGis && (
        <Card variant="outlined">
          <CardContent>
            <SectionHeader
              icon={<PublicIcon color="action" />}
              title={`GIS — שכבות סיכון (${gisLayers.data?.length ?? 0})`}
              subtitle="השוואת שכבת אזורי הצפה/אקלים חיצונית מול סקר הסיכונים הפנימי לכל נכס."
              action={
                <Button size="small" startIcon={<RefreshIcon />} onClick={() => gisLayers.refetch()} disabled={gisLayers.isFetching}>
                  רענון
                </Button>
              }
            />

            {gisLayers.isLoading ? (
              <CircularProgress size={20} />
            ) : (
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>נכס</TableCell>
                      <TableCell>אזור הצפה (GIS)</TableCell>
                      <TableCell align="left">מדד סיכון אקלים</TableCell>
                      <TableCell align="left">ציון הצפה פנימי</TableCell>
                      <TableCell>התאמה</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(gisLayers.data ?? []).map((row) => (
                      <TableRow key={row.property_id} hover>
                        <TableCell>
                          {row.name}
                          <Typography variant="caption" color="text.secondary" display="block">
                            {row.flood_zone_description}
                          </Typography>
                        </TableCell>
                        <TableCell>{row.flood_zone}</TableCell>
                        <TableCell align="left">{row.climate_risk_index}</TableCell>
                        <TableCell align="left">{row.internal_flood_risk_score ?? "-"}</TableCell>
                        <TableCell>
                          {row.mismatch_with_internal_survey ? (
                            <Chip size="small" color="warning" label="פער מהסקר הפנימי" />
                          ) : (
                            <Chip size="small" color="success" variant="outlined" label="תואם" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      <Card variant="outlined">
        <CardContent>
          <SectionHeader
            icon={<ThunderstormIcon color="action" />}
            title={`התראות מזג אוויר (${weatherAlerts.data?.length ?? 0})`}
            subtitle="התראות מזג אוויר קיצוני פעילות לפי מיקום הנכסים."
            action={
              <Button size="small" startIcon={<RefreshIcon />} onClick={() => weatherAlerts.refetch()} disabled={weatherAlerts.isFetching}>
                רענון
              </Button>
            }
          />

          {weatherAlerts.isLoading ? (
            <CircularProgress size={20} />
          ) : (weatherAlerts.data ?? []).length > 0 ? (
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>נכס</TableCell>
                    <TableCell>סוג התראה</TableCell>
                    <TableCell>חומרה</TableCell>
                    <TableCell>פורסם בתאריך</TableCell>
                    <TableCell>מקור</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(weatherAlerts.data ?? []).map((row) => (
                    <TableRow key={`${row.property_id}-${row.issued_at}`} hover>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{WEATHER_ALERT_TYPE_LABELS[row.alert_type] ?? row.alert_type}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={WEATHER_SEVERITY_LABELS[row.severity] ?? row.severity}
                          color={WEATHER_SEVERITY_COLOR[row.severity] ?? "default"}
                        />
                      </TableCell>
                      <TableCell>{formatDateTime(row.issued_at)}</TableCell>
                      <TableCell>{row.source_system}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              אין כרגע התראות מזג אוויר פעילות.
            </Typography>
          )}
        </CardContent>
      </Card>

      {canReadEconomics && (
        <Card variant="outlined">
          <CardContent>
            <SectionHeader
              icon={<TrendingUpIcon color="action" />}
              title="מדדים כלכליים והצעות עדכון שווי כינון"
              subtitle="מדד תשומות בנייה ומדד המחירים לצרכן, והמלצות עדכון שווי כינון לפי סטייה מהמדד."
              action={
                <Button
                  size="small"
                  startIcon={<RefreshIcon />}
                  onClick={() => {
                    economicIndex.refetch();
                    replacementUpdates.refetch();
                  }}
                  disabled={economicIndex.isFetching || replacementUpdates.isFetching}
                >
                  רענון
                </Button>
              }
            />

            {economicIndex.data && (
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={6} sm={3}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    מדד תשומות בנייה
                  </Typography>
                  <Typography sx={{ fontWeight: 700 }}>{economicIndex.data.construction_cost_index.toFixed(1)}</Typography>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    מדד המחירים לצרכן
                  </Typography>
                  <Typography sx={{ fontWeight: 700 }}>{economicIndex.data.cpi_index.toFixed(1)}</Typography>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    נכון לתאריך
                  </Typography>
                  <Typography sx={{ fontWeight: 700 }}>{formatDate(economicIndex.data.as_of)}</Typography>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    מקור
                  </Typography>
                  <Typography sx={{ fontWeight: 700 }}>{economicIndex.data.source_system}</Typography>
                </Grid>
              </Grid>
            )}

            {replacementUpdates.isLoading ? (
              <CircularProgress size={20} />
            ) : (
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>נכס</TableCell>
                      <TableCell align="left">שווי כינון נוכחי</TableCell>
                      <TableCell align="left">שווי מוצע</TableCell>
                      <TableCell align="left">סטייה</TableCell>
                      <TableCell>מומלץ לעדכון</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(replacementUpdates.data ?? []).map((row) => (
                      <TableRow key={row.property_id} hover>
                        <TableCell>{row.name}</TableCell>
                        <TableCell align="left">{formatIls(row.current_replacement_value)}</TableCell>
                        <TableCell align="left">{formatIls(row.suggested_replacement_value)}</TableCell>
                        <TableCell align="left">{formatPercent(row.drift_percent / 100)}</TableCell>
                        <TableCell>
                          {row.recommended_for_revaluation ? (
                            <Chip size="small" color="warning" label="מומלץ" />
                          ) : (
                            <Chip size="small" variant="outlined" label="לא נדרש" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}
