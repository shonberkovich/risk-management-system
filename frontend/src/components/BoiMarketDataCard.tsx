import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import RefreshIcon from "@mui/icons-material/Refresh";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";

import { fetchBoiMarketData, type BoiSeries } from "../api/client";
import { formatDate } from "../format";

// Real values from app/integrations/economics.py's BOI series identifiers — the
// display labels (₪/USD, ₪/EUR, YoY inflation) are mapped from those, not guessed.
const SERIES_LABELS: Record<string, string> = {
  USD_ILS: "שער דולר/שקל",
  EUR_ILS: "שער אירו/שקל",
  CPI_YOY_INFLATION: "אינפלציה שנתית (YoY)",
};

function formatSeriesValue(series: BoiSeries): string {
  if (series.value == null) return "—";
  if (series.unit === "%") return `${series.value.toFixed(2)}%`;
  return series.value.toFixed(4);
}

/** Real Bank of Israel market-data card (TODO_SPEC.md §1) — currency exchange rates
 * (USD/EUR) and YoY CPI inflation, from GET /api/integrations/economics/boi-market-data.
 * Same "simulated feed" visual language as the other Integrations.tsx cards, but this
 * one is a real external call — see app/integrations/economics.py's docstring for the
 * BOI API details and how a per-series failure degrades to status!="ok" instead of
 * failing the whole request. */
export default function BoiMarketDataCard() {
  const boiData = useQuery({ queryKey: ["boi-market-data"], queryFn: fetchBoiMarketData });

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <AccountBalanceIcon color="action" />
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                בנק ישראל — נתוני שוק
              </Typography>
              <Typography variant="caption" color="text.secondary">
                שערי חליפין ואינפלציה שנתית, נתונים אמיתיים מבנק ישראל.
              </Typography>
            </Box>
          </Stack>
          <Button
            size="small"
            startIcon={<RefreshIcon />}
            onClick={() => boiData.refetch()}
            disabled={boiData.isFetching}
          >
            רענון
          </Button>
        </Stack>

        {boiData.isLoading ? (
          <CircularProgress size={20} />
        ) : boiData.data ? (
          <Stack spacing={1.5}>
            <Grid container spacing={2}>
              {boiData.data.series.map((s) => (
                <Grid item xs={6} sm={4} key={s.series}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {SERIES_LABELS[s.series] ?? s.series}
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap" useFlexGap>
                    <Typography sx={{ fontWeight: 700 }}>{formatSeriesValue(s)}</Typography>
                    {s.status !== "ok" && <Chip size="small" color="warning" label={s.status} variant="outlined" />}
                    {/* Each series can come from a different real source (e.g. cpi_yoy_percent
                        from CBS, exchange rates from BOI) — shown per-row whenever it differs
                        from the card's overall source_system footer below. */}
                    {s.source_system !== boiData.data!.source_system && (
                      <Chip size="small" variant="outlined" label={s.source_system} />
                    )}
                  </Stack>
                </Grid>
              ))}
            </Grid>
            <Typography variant="caption" color="text.secondary">
              נכון לתאריך {formatDate(boiData.data.as_of)} · מקור: {boiData.data.source_system}
            </Typography>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            לא ניתן היה לטעון נתוני בנק ישראל כרגע.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
