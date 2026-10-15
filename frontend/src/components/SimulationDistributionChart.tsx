import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { HistogramBucket } from "../api/client";
import { formatIlsCompact } from "../format";
import { useTokens } from "../ui/useTokens";

/** Histogram of simulated portfolio/property loss totals, with vertical reference
 * lines marking VaR95/VaR99 so the reader can see where those percentiles sit
 * relative to the shape of the full distribution (not just as a bare number). */
export default function SimulationDistributionChart({
  distribution,
  var95,
  var99,
}: {
  distribution: HistogramBucket[];
  var95: number;
  var99: number;
}) {
  const theme = useTheme();
  const { neon, seriesPalette } = useTokens();
  const chartData = distribution.map((b) => ({
    ...b,
    label: formatIlsCompact((b.bucket_min + b.bucket_max) / 2),
  }));

  if (chartData.length === 0) {
    return (
      <Typography color="text.secondary" variant="body2">
        אין נתוני סימולציה זמינים.
      </Typography>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      {/* top: room for the two staggered VaR labels; right: the last tick label is centred
          on the last bar and would otherwise be clipped at the chart edge. */}
      <BarChart data={chartData} margin={{ top: 30, right: 26, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="rmis-sim-bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={neon.cyan} stopOpacity={0.95} />
            <stop offset="100%" stopColor={neon.violet} stopOpacity={0.4} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={8} />
        <YAxis tick={{ fontSize: 12 }} width={40} allowDecimals={false} />
        <Tooltip
          contentStyle={{ direction: "rtl", fontFamily: theme.typography.fontFamily }}
          formatter={(value, _name, item) => [
            `${value} הרצות`,
            `${formatIlsCompact(item.payload.bucket_min)}–${formatIlsCompact(item.payload.bucket_max)}`,
          ]}
        />
        <ReferenceLine
          x={chartData.reduce((closest, d) => (Math.abs((d.bucket_min + d.bucket_max) / 2 - var95) < Math.abs((closest.bucket_min + closest.bucket_max) / 2 - var95) ? d : closest)).label}
          stroke={neon.medium}
          strokeDasharray="4 4"
          label={{ value: "VaR 95%", fontSize: 11, fill: neon.medium, position: "top", offset: 4 }}
        />
        <ReferenceLine
          x={chartData.reduce((closest, d) => (Math.abs((d.bucket_min + d.bucket_max) / 2 - var99) < Math.abs((closest.bucket_min + closest.bucket_max) / 2 - var99) ? d : closest)).label}
          stroke={neon.critical}
          strokeDasharray="4 4"
          // Raised one line above VaR 95%: on a phone-width chart the two lines often sit a
          // bar or two apart and same-height labels printed over each other.
          label={{ value: "VaR 99%", fontSize: 11, fill: neon.critical, position: "top", offset: 17 }}
        />
        <Bar dataKey="count" fill="url(#rmis-sim-bar)" radius={[6, 6, 1, 1]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
