import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { LossRatioTrendPoint } from "../api/client";
import { formatIlsCompact, formatPercent } from "../format";

const TARGET_LOSS_RATIO = 0.35; // organizational target, matches the KpiCard subtext on the dashboard

export default function LossRatioTrendChart({ data }: { data: LossRatioTrendPoint[] }) {
  const theme = useTheme();
  const chartData = data.map((d) => ({ ...d, percent: d.loss_ratio * 100 }));

  return (
    <div>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
        מגמת יחס נזקים (Loss Ratio) רב-שנתית
      </Typography>
      {chartData.length === 0 ? (
        <Typography color="text.secondary" variant="body2">
          אין נתוני תביעות זמינים.
        </Typography>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12 }} width={44} />
            <ReferenceLine y={TARGET_LOSS_RATIO * 100} stroke="#2e7d32" strokeDasharray="4 4" label={{ value: "יעד", fontSize: 11, fill: "#2e7d32" }} />
            <Tooltip
              contentStyle={{ direction: "rtl", fontFamily: theme.typography.fontFamily }}
              formatter={(_value, _name, item) => [
                `${formatPercent(item.payload.loss_ratio)} (${formatIlsCompact(item.payload.total_claimed)} מתוך ${formatIlsCompact(item.payload.total_annual_premium)})`,
                "יחס נזקים",
              ]}
              labelFormatter={(year) => `שנת ${year}`}
            />
            <Line type="monotone" dataKey="percent" stroke="#1e5b8a" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
