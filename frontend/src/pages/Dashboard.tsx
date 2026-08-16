import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import CloseIcon from "@mui/icons-material/Close";
import GavelIcon from "@mui/icons-material/Gavel";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import WarningIcon from "@mui/icons-material/Warning";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  fetchAlerts,
  fetchClaims,
  fetchHazardDistribution,
  fetchKpis,
  fetchLossRatioTrend,
  fetchMapPoints,
  fetchRiskMatrix,
  type RiskMatrixCell,
} from "../api/client";
import AlertsBanner from "../components/AlertsBanner";
import ClaimsTable from "../components/ClaimsTable";
import HazardChart from "../components/HazardChart";
import KpiCard from "../components/KpiCard";
import LossRatioTrendChart from "../components/LossRatioTrendChart";
import RiskMap from "../components/RiskMap";
import RiskMatrix from "../components/RiskMatrix";
import { formatIlsCompact, formatPercent } from "../format";

const BAND_LABELS: Record<string, string> = { low: "נמוכה", medium: "בינונית", high: "גבוהה" };

export default function Dashboard() {
  const kpis = useQuery({ queryKey: ["kpis"], queryFn: fetchKpis });
  const alerts = useQuery({ queryKey: ["alerts"], queryFn: fetchAlerts });
  const mapPoints = useQuery({ queryKey: ["map"], queryFn: fetchMapPoints });
  const riskMatrix = useQuery({ queryKey: ["risk-matrix"], queryFn: fetchRiskMatrix });
  const hazardDist = useQuery({ queryKey: ["hazard-distribution"], queryFn: fetchHazardDistribution });
  const lossRatioTrend = useQuery({ queryKey: ["loss-ratio-trend"], queryFn: fetchLossRatioTrend });
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
    <Stack spacing={3}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        דשבורד מנהלים
      </Typography>

      {alerts.data && <AlertsBanner alerts={alerts.data} />}

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard
            label="סך שווי מבוטח (TIV)"
            value={formatIlsCompact(kpis.data?.tiv ?? 0)}
            icon={<AccountBalanceWalletIcon color="primary" fontSize="large" />}
            accentColor="#1e5b8a"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard
            label="חשיפה מקסימלית (MFL)"
            value={formatIlsCompact(kpis.data?.mfl ?? 0)}
            subtext="אשכול גיאוגרפי מרוכז ביותר"
            icon={<WarningIcon color="warning" fontSize="large" />}
            accentColor="#e69413"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard
            label="תביעות פתוחות"
            value={`${kpis.data?.open_claims_count ?? 0}`}
            subtext={`${formatIlsCompact(kpis.data?.open_claims_amount ?? 0)} סה"כ`}
            icon={<GavelIcon color="secondary" fontSize="large" />}
            accentColor="#c0521f"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard
            label="יחס נזקים (Loss Ratio)"
            value={formatPercent(kpis.data?.loss_ratio ?? 0)}
            subtext={`יעד ארגוני: <35%`}
            trend={(kpis.data?.loss_ratio ?? 0) > 0.35 ? "up" : "down"}
            icon={<ShowChartIcon color="success" fontSize="large" />}
            accentColor="#2e7d32"
          />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid item xs={12} md={8}>
          <Card variant="outlined">
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
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
              {filteredMapPoints && <RiskMap points={filteredMapPoints} />}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Stack spacing={2}>
            <Card variant="outlined">
              <CardContent>
                {riskMatrix.data && (
                  <RiskMatrix cells={riskMatrix.data} selectedCell={selectedCell} onSelectCell={setSelectedCell} />
                )}
              </CardContent>
            </Card>
            <Card variant="outlined">
              <CardContent>{hazardDist.data && <HazardChart data={hazardDist.data} />}</CardContent>
            </Card>
          </Stack>
        </Grid>
      </Grid>

      <Card variant="outlined">
        <CardContent>{lossRatioTrend.data && <LossRatioTrendChart data={lossRatioTrend.data} />}</CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
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
