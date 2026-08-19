import CasinoIcon from "@mui/icons-material/Casino";
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
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  fetchPortfolioSimulation,
  fetchProperties,
  fetchPropertySimulation,
} from "../api/client";
import KpiCard from "../components/KpiCard";
import SimulationDistributionChart from "../components/SimulationDistributionChart";
import { formatIlsCompact } from "../format";

const ITERATION_OPTIONS = [1000, 5000, 10000, 25000];

export default function Simulation() {
  const [scope, setScope] = useState<"portfolio" | number>("portfolio");
  const [iterations, setIterations] = useState(10000);
  const [horizonYears, setHorizonYears] = useState(1);
  const [runParams, setRunParams] = useState<{
    scope: "portfolio" | number;
    iterations: number;
    horizonYears: number;
  } | null>(null);

  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });

  const portfolioResult = useQuery({
    queryKey: ["simulation-portfolio", runParams],
    queryFn: () =>
      fetchPortfolioSimulation({ iterations: runParams!.iterations, horizon_years: runParams!.horizonYears }),
    enabled: !!runParams && runParams.scope === "portfolio",
  });

  const propertyResult = useQuery({
    queryKey: ["simulation-property", runParams],
    queryFn: () =>
      fetchPropertySimulation(runParams!.scope as number, {
        iterations: runParams!.iterations,
        horizon_years: runParams!.horizonYears,
      }),
    enabled: !!runParams && runParams.scope !== "portfolio",
  });

  const activeQuery = runParams?.scope === "portfolio" ? portfolioResult : propertyResult;
  const result = activeQuery.data;

  function runSimulation() {
    setRunParams({ scope, iterations, horizonYears });
  }

  return (
    <Stack spacing={3}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        סימולציית תיק וניתוח VaR
      </Typography>
      <Typography variant="body2" color="text.secondary">
        סימולציית מונטה קרלו של הפסדים צפויים על בסיס הסתברות אירוע וחומרה מבוססות פרופיל הסיכון של כל נכס. ראו{" "}
        <code>backend/app/services/simulation.py</code> למודל המלא (הדגמה לימודית — ללא קורלציה בין נכסים).
      </Typography>

      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center">
            <TextField
              select
              size="small"
              label="היקף"
              value={scope}
              onChange={(e) => setScope(e.target.value === "portfolio" ? "portfolio" : Number(e.target.value))}
              sx={{ minWidth: 220 }}
            >
              <MenuItem value="portfolio">כל התיק (Portfolio)</MenuItem>
              {properties.data?.map((p) => (
                <MenuItem key={p.property_id} value={p.property_id}>
                  {p.name}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              size="small"
              label="מספר הרצות"
              value={iterations}
              onChange={(e) => setIterations(Number(e.target.value))}
              sx={{ minWidth: 150 }}
            >
              {ITERATION_OPTIONS.map((n) => (
                <MenuItem key={n} value={n}>
                  {n.toLocaleString("he-IL")}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              size="small"
              type="number"
              label="אופק (שנים)"
              value={horizonYears}
              onChange={(e) => setHorizonYears(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              inputProps={{ min: 1, max: 50 }}
              sx={{ width: 130 }}
            />

            <Button
              variant="contained"
              startIcon={activeQuery.isFetching ? <CircularProgress size={16} color="inherit" /> : <CasinoIcon />}
              onClick={runSimulation}
              disabled={activeQuery.isFetching}
            >
              {activeQuery.isFetching ? "מריץ סימולציה..." : "הרץ סימולציה"}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {activeQuery.isError && (
        <Alert severity="error">שגיאה בהרצת הסימולציה. ודא שהנכס נבחר תקין ובעל פרופיל סיכון.</Alert>
      )}

      {!runParams && !result && (
        <Typography color="text.secondary" variant="body2">
          בחר היקף ולחץ "הרץ סימולציה" כדי לקבל הפסד צפוי, תרחיש גרוע, ואחוזוני VaR מבוססי הרצות מונטה קרלו.
        </Typography>
      )}

      {result && (
        <>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard
                label="הפסד שנתי צפוי"
                value={formatIlsCompact(result.expected_annual_loss)}
                accentColor="#1e5b8a"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard
                label="תרחיש גרוע (מקסימלי בסימולציה)"
                value={formatIlsCompact(result.worst_case_simulated_loss)}
                accentColor="#c0521f"
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard label="VaR 95%" value={formatIlsCompact(result.var_95)} accentColor="#e69413" />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <KpiCard label="VaR 99%" value={formatIlsCompact(result.var_99)} accentColor="#c0521f" />
            </Grid>
          </Grid>

          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
                התפלגות תוצאות הסימולציה ({result.iterations.toLocaleString("he-IL")} הרצות, אופק{" "}
                {result.horizon_years} {result.horizon_years === 1 ? "שנה" : "שנים"}
                {"properties_simulated" in result ? ` · ${result.properties_simulated} נכסים` : ""})
              </Typography>
              <SimulationDistributionChart
                distribution={result.distribution}
                var95={result.var_95}
                var99={result.var_99}
              />
            </CardContent>
          </Card>
        </>
      )}
    </Stack>
  );
}
