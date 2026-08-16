import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import GavelIcon from "@mui/icons-material/Gavel";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import WarningIcon from "@mui/icons-material/Warning";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";

import { fetchClaims, fetchHazardDistribution, fetchKpis, fetchMapPoints, fetchRiskMatrix } from "../api/client";
import ClaimsTable from "../components/ClaimsTable";
import HazardChart from "../components/HazardChart";
import KpiCard from "../components/KpiCard";
import RiskMap from "../components/RiskMap";
import RiskMatrix from "../components/RiskMatrix";
import { formatIlsCompact, formatPercent } from "../format";

export default function Dashboard() {
  const kpis = useQuery({ queryKey: ["kpis"], queryFn: fetchKpis });
  const mapPoints = useQuery({ queryKey: ["map"], queryFn: fetchMapPoints });
  const riskMatrix = useQuery({ queryKey: ["risk-matrix"], queryFn: fetchRiskMatrix });
  const hazardDist = useQuery({ queryKey: ["hazard-distribution"], queryFn: fetchHazardDistribution });
  const claims = useQuery({ queryKey: ["claims"], queryFn: () => fetchClaims() });

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
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
                מפת חשיפה מרחבית ואירועים
              </Typography>
              {mapPoints.data && <RiskMap points={mapPoints.data} />}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Stack spacing={2}>
            <Card variant="outlined">
              <CardContent>{riskMatrix.data && <RiskMatrix cells={riskMatrix.data} />}</CardContent>
            </Card>
            <Card variant="outlined">
              <CardContent>{hazardDist.data && <HazardChart data={hazardDist.data} />}</CardContent>
            </Card>
          </Stack>
        </Grid>
      </Grid>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
            אירועים בטיפול וסטטוס תביעות ביטוח פתוחות
          </Typography>
          {claims.isLoading ? (
            <CircularProgress size={24} />
          ) : (
            <ClaimsTable rows={claims.data ?? []} />
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}
