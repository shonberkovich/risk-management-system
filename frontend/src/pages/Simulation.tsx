import CasinoIcon from "@mui/icons-material/Casino";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
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

// Mirrors routers/simulation.py's MAX_ITERATIONS/MAX_HORIZON_YEARS (server-side bounds,
// gt=0/le=max on both query params) — the sliders can't ask for something the API would
// reject with a 422.
const ITERATIONS_MIN = 1_000;
const ITERATIONS_MAX = 100_000;
const ITERATIONS_MARKS = [1_000, 10_000, 25_000, 50_000, 100_000].map((v) => ({
  value: v,
  label: v.toLocaleString("he-IL"),
}));
const HORIZON_MIN = 1;
const HORIZON_MAX = 50;
const HORIZON_MARKS = [1, 5, 10, 25, 50].map((v) => ({ value: v, label: String(v) }));

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

            <Box sx={{ minWidth: 260, px: 1 }}>
              <Typography variant="caption" color="text.secondary">
                מספר הרצות: {iterations.toLocaleString("he-IL")}
              </Typography>
              <Slider
                size="small"
                value={iterations}
                onChange={(_, v) => setIterations(v as number)}
                min={ITERATIONS_MIN}
                max={ITERATIONS_MAX}
                step={1000}
                marks={ITERATIONS_MARKS}
                valueLabelDisplay="auto"
                valueLabelFormat={(v) => v.toLocaleString("he-IL")}
              />
            </Box>

            <Box sx={{ minWidth: 220, px: 1 }}>
              <Typography variant="caption" color="text.secondary">
                אופק: {horizonYears} {horizonYears === 1 ? "שנה" : "שנים"}
              </Typography>
              <Slider
                size="small"
                value={horizonYears}
                onChange={(_, v) => setHorizonYears(v as number)}
                min={HORIZON_MIN}
                max={HORIZON_MAX}
                step={1}
                marks={HORIZON_MARKS}
                valueLabelDisplay="auto"
              />
            </Box>

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
