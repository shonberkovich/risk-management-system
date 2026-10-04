import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import CloseIcon from "@mui/icons-material/Close";
import GavelIcon from "@mui/icons-material/Gavel";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import WarningIcon from "@mui/icons-material/Warning";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  fetchAlerts,
  fetchCashflowSummary,
  fetchClaims,
  fetchGeographicExposureClusters,
  fetchHazardDistribution,
  fetchHomeFrontAlerts,
  fetchIncidents,
  fetchKpis,
  fetchLossRatioTrend,
  fetchMapPoints,
  fetchProperties,
  fetchRiskMatrix,
  fetchWeatherAlerts,
  type RiskMatrixCell,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import AlertsBanner from "../components/AlertsBanner";
import CashflowChart from "../components/CashflowChart";
import ClaimsTable from "../components/ClaimsTable";
import HazardChart from "../components/HazardChart";
import KpiCard from "../components/KpiCard";
import LossRatioTrendChart from "../components/LossRatioTrendChart";
import RiskMap from "../components/RiskMap";
import RiskCore3D from "../components/RiskCore3D";
import RiskMatrix from "../components/RiskMatrix";
import { formatIlsCompact, formatPercent } from "../format";
import { ink, neon } from "../ui/tokens";
import FieldWorkerDashboard from "./FieldWorkerDashboard";

const BAND_LABELS: Record<string, string> = { low: "נמוכה", medium: "בינונית", high: "גבוהה" };

// Home Front Command (פיקוד העורף) is a live real-time public feed (TODO_SPEC.md §14,
// "באנר התראות חירום מרחביות") — unlike the other dashboard queries here, it needs to
// refresh on its own without a page reload, so it polls rather than fetching once.
const HOME_FRONT_POLL_INTERVAL_MS = 60_000;

/** Routes "/" to a role-appropriate dashboard rather than gating individual widgets on
 * the executive view below: FIELD_WORKER has no server-side access to the financial
 * data (KPIs, cashflow, policies — see routers/analytics.py's _FINANCIAL_READ_ROLES)
 * this page is built around, so it gets FieldWorkerDashboard.tsx instead
 * (TODO_SPEC.md §5, "דשבורד מותאם לשטח"). */
export default function Dashboard() {
  const { user } = useAuth();
  if (user?.role === "FIELD_WORKER") {
    return <FieldWorkerDashboard />;
  }
  return <ExecutiveDashboard />;
}

function ExecutiveDashboard() {
  const kpis = useQuery({ queryKey: ["kpis"], queryFn: fetchKpis });
  const alerts = useQuery({ queryKey: ["alerts"], queryFn: fetchAlerts });
  const weatherAlerts = useQuery({ queryKey: ["weather-alerts"], queryFn: () => fetchWeatherAlerts() });
  const homeFrontAlerts = useQuery({
    queryKey: ["home-front-alerts"],
    queryFn: fetchHomeFrontAlerts,
    refetchInterval: HOME_FRONT_POLL_INTERVAL_MS,
  });
  const mapPoints = useQuery({ queryKey: ["map"], queryFn: fetchMapPoints });
  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const incidents = useQuery({ queryKey: ["incidents", "all"], queryFn: () => fetchIncidents() });
  const exposureClusters = useQuery({
    queryKey: ["geographic-exposure-clusters"],
    queryFn: fetchGeographicExposureClusters,
  });
  const riskMatrix = useQuery({ queryKey: ["risk-matrix"], queryFn: fetchRiskMatrix });
  const hazardDist = useQuery({ queryKey: ["hazard-distribution"], queryFn: fetchHazardDistribution });
  const lossRatioTrend = useQuery({ queryKey: ["loss-ratio-trend"], queryFn: fetchLossRatioTrend });
  const cashflow = useQuery({ queryKey: ["cashflow"], queryFn: () => fetchCashflowSummary() });
  const claims = useQuery({ queryKey: ["claims"], queryFn: () => fetchClaims() });
  const [selectedCell, setSelectedCell] = useState<RiskMatrixCell | null>(null);

  const filteredMapPoints = useMemo(() => {
    if (!mapPoints.data) return mapPoints.data;
    if (!selectedCell) return mapPoints.data;
    const ids = new Set(selectedCell.property_ids);
    return mapPoints.data.filter((p) => ids.has(p.property_id));
  }, [mapPoints.data, selectedCell]);

  const filteredClaims = useMemo(() => {
    if (!claims.data) return claims.data;
    if (!selectedCell || !mapPoints.data) return claims.data;
    const ids = new Set(selectedCell.property_ids);
    const names = new Set(mapPoints.data.filter((p) => ids.has(p.property_id)).map((p) => p.name));
    return claims.data.filter((c) => names.has(c.property_name));
  }, [claims.data, mapPoints.data, selectedCell]);

  const loading = kpis.isLoading || mapPoints.isLoading;

  if (loading) {
    return (
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }

  return (
    <Stack spacing={{ xs: 2, md: 2.5 }}>
      {/* ---- Bento row 1: hero (title + 3D Risk Core) beside a 2×2 KPI cluster ---- */}
      <Box className="rmis-bento" sx={BENTO_SX}>
        <Box
          className="rmis-spot"
          sx={{
            ...GLASS_TILE_SX,
            gridColumn: { xs: "1 / -1", lg: "span 7" },
            minHeight: { xs: "auto", md: 260 },
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 2,
            p: { xs: 2.5, sm: 3.5, md: 4 },
            backgroundImage: `radial-gradient(90% 120% at 100% 0%, ${alpha(neon.violet, 0.22)} 0%, transparent 55%), radial-gradient(70% 90% at 0% 100%, ${alpha(neon.cyan, 0.12)} 0%, transparent 60%)`,
          }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              דשבורד מנהלים
            </Typography>
            <Typography variant="body1" sx={{ color: "text.secondary", mt: 1.5, maxWidth: 520, lineHeight: 1.7 }}>
              תמונת מצב חיה של תיק הנכסים — חשיפה, אירועים, תביעות ותזרים, במסך אחד.
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 2.5, flexWrap: "wrap", rowGap: 1 }}>
              <Box sx={HERO_PILL_SX}>
                <span className="rmis-pulse" />
                ניטור בזמן אמת
              </Box>
              <Box sx={{ ...HERO_PILL_SX, color: neon.violet, borderColor: alpha(neon.violet, 0.35), bgcolor: alpha(neon.violet, 0.08) }}>
                ISO 31000
              </Box>
            </Stack>
          </Box>
          <Box sx={{ display: { xs: "none", sm: "block" }, flexShrink: 0, mx: { sm: 3, md: 5 } }}>
            <RiskCore3D size={200} />
          </Box>
        </Box>

        <Box
          sx={{
            gridColumn: { xs: "1 / -1", lg: "span 5" },
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))", lg: "repeat(2, minmax(0, 1fr))" },
            gap: { xs: 1.5, md: 2 },
          }}
        >
          <KpiCard
            label="סך שווי מבוטח (TIV)"
            value={formatIlsCompact(kpis.data?.tiv ?? 0)}
            icon={<AccountBalanceWalletIcon color="primary" fontSize="large" />}
            accentColor="#1e5b8a"
          />
          <KpiCard
            label="חשיפה מקסימלית (MFL)"
            value={formatIlsCompact(kpis.data?.mfl ?? 0)}
            subtext="אשכול גיאוגרפי מרוכז ביותר"
            icon={<WarningIcon color="warning" fontSize="large" />}
            accentColor="#e69413"
          />
          <KpiCard
            label="תביעות פתוחות"
            value={`${kpis.data?.open_claims_count ?? 0}`}
            subtext={`${formatIlsCompact(kpis.data?.open_claims_amount ?? 0)} סה"כ`}
            icon={<GavelIcon color="secondary" fontSize="large" />}
            accentColor="#c0521f"
          />
          <KpiCard
            label="יחס נזקים (Loss Ratio)"
            value={formatPercent(kpis.data?.loss_ratio ?? 0)}
            subtext={`יעד ארגוני: <35%`}
            trend={(kpis.data?.loss_ratio ?? 0) > 0.35 ? "up" : "down"}
            icon={<ShowChartIcon color="success" fontSize="large" />}
            accentColor="#2e7d32"
          />
        </Box>
      </Box>

      {alerts.data && (
        <AlertsBanner alerts={alerts.data} weatherAlerts={weatherAlerts.data} homeFrontAlerts={homeFrontAlerts.data} />
      )}

      {/* ---- Bento row 2: spatial map (tall) + risk matrix + hazard mix ---- */}
      <Box className="rmis-bento" sx={BENTO_SX}>
        <Card sx={{ gridColumn: { xs: "1 / -1", lg: "span 8" }, gridRow: { lg: "span 2" } }}>
          <CardContent>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 1.5, flexWrap: "wrap", gap: 1 }}
            >
              <Typography variant="subtitle2" sx={TILE_TITLE_SX}>
                מפת חשיפה מרחבית ואירועים
              </Typography>
              {selectedCell && (
                <Chip
                  size="small"
                  color="primary"
                  onDelete={() => setSelectedCell(null)}
                  deleteIcon={<CloseIcon />}
                  label={`מסונן: הסתברות ${BAND_LABELS[selectedCell.probability_band]} × חומרה ${BAND_LABELS[selectedCell.severity_band]} (${selectedCell.property_ids.length} נכסים)`}
                />
              )}
            </Stack>
            {filteredMapPoints && (
              <RiskMap
                points={filteredMapPoints}
                properties={properties.data}
                incidents={incidents.data}
                exposureClusters={exposureClusters.data}
              />
            )}
          </CardContent>
        </Card>
        <Card sx={{ gridColumn: { xs: "1 / -1", md: "span 6", lg: "span 4" } }}>
          <CardContent>
            {riskMatrix.data && (
              <RiskMatrix cells={riskMatrix.data} selectedCell={selectedCell} onSelectCell={setSelectedCell} />
            )}
          </CardContent>
        </Card>
        <Card sx={{ gridColumn: { xs: "1 / -1", md: "span 6", lg: "span 4" } }}>
          <CardContent>{hazardDist.data && <HazardChart data={hazardDist.data} />}</CardContent>
        </Card>
      </Box>

      {/* ---- Bento row 3: asymmetric 5/7 split of the two financial trend tiles ---- */}
      <Box className="rmis-bento" sx={BENTO_SX}>
        <Card sx={{ gridColumn: { xs: "1 / -1", lg: "span 5" } }}>
          <CardContent>{lossRatioTrend.data && <LossRatioTrendChart data={lossRatioTrend.data} />}</CardContent>
        </Card>
        <Card sx={{ gridColumn: { xs: "1 / -1", lg: "span 7" } }}>
          <CardContent>{cashflow.data && <CashflowChart data={cashflow.data} />}</CardContent>
        </Card>
      </Box>

      <Card>
        <CardContent>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            sx={{ mb: 1.5, flexWrap: "wrap", gap: 1 }}
          >
            <Typography variant="subtitle2" sx={TILE_TITLE_SX}>
              אירועים בטיפול וסטטוס תביעות ביטוח פתוחות
            </Typography>
            {selectedCell && (
              <Chip
                size="small"
                variant="outlined"
                onDelete={() => setSelectedCell(null)}
                deleteIcon={<CloseIcon />}
                label="מסונן לפי תא הסיכון שנבחר"
              />
            )}
          </Stack>
          {claims.isLoading ? (
            <CircularProgress size={24} />
          ) : (
            <ClaimsTable rows={filteredClaims ?? []} />
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}

// ---- Presentation-only style constants for the bento layout ----

const BENTO_SX = {
  display: "grid",
  gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(12, minmax(0, 1fr))" },
  gap: { xs: 1.5, md: 2.5 },
  alignItems: "stretch",
} as const;

const GLASS_TILE_SX = {
  position: "relative",
  isolation: "isolate",
  overflow: "hidden",
  borderRadius: "26px",
  border: `1px solid ${ink.line}`,
  bgcolor: "rgba(13, 19, 44, 0.5)",
  backdropFilter: "blur(22px) saturate(160%)",
  WebkitBackdropFilter: "blur(22px) saturate(160%)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 30px 80px -40px rgba(0,0,0,0.9)",
} as const;

const HERO_PILL_SX = {
  display: "inline-flex",
  alignItems: "center",
  gap: 1,
  px: 1.5,
  py: 0.6,
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  color: neon.low,
  border: `1px solid ${alpha(neon.low, 0.3)}`,
  bgcolor: alpha(neon.low, 0.07),
  backdropFilter: "blur(8px)",
} as const;

const TILE_TITLE_SX = {
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  gap: 1,
  "&::before": {
    content: '""',
    width: 6,
    height: 6,
    borderRadius: "50%",
    bgcolor: neon.cyan,
    boxShadow: `0 0 10px ${neon.cyan}`,
    flexShrink: 0,
  },
} as const;
