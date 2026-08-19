import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { CashflowSummary } from "../api/client";
import { formatIlsCompact } from "../format";

const monthLabel = (month: string) => {
  if (month === "unscheduled") return "לא מתוזמן";
  const [year, m] = month.split("-");
  return `${m}/${year.slice(2)}`;
};

export default function CashflowChart({ data }: { data: CashflowSummary }) {
  const theme = useTheme();
  const chartData = data.monthly.map((d) => ({ ...d, label: monthLabel(d.month) }));

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
        תזרים צפוי ורזרבות פתוחות
      </Typography>

      <Grid container spacing={2}>
        <Grid item xs={12} sm={4}>
          <Stack>
            <Typography variant="caption" color="text.secondary">
              סך רזרבות פתוחות
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {formatIlsCompact(data.total_open_reserves)}
            </Typography>
          </Stack>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Stack>
            <Typography variant="caption" color="text.secondary">
              סך תקבולים צפויים (תביעות פתוחות)
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {formatIlsCompact(data.total_expected_receipts)}
            </Typography>
          </Stack>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Stack>
            <Typography variant="caption" color="text.secondary">
              רזרבות ללא תאריך תשלום צפוי
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {formatIlsCompact(data.unscheduled_reserves)}
            </Typography>
          </Stack>
        </Grid>
      </Grid>

      {chartData.length === 0 ? (
        <Typography color="text.secondary" variant="body2">
          אין נתוני תזרים מתוזמנים זמינים.
        </Typography>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={(v) => formatIlsCompact(v)} tick={{ fontSize: 12 }} width={60} />
            <Tooltip
              contentStyle={{ direction: "rtl", fontFamily: theme.typography.fontFamily }}
              formatter={(value: number, name) => [
                formatIlsCompact(value),
                name === "expected_receipts" ? "תקבולים צפויים" : "רזרבות פתוחות",
              ]}
              labelFormatter={(label) => `חודש: ${label}`}
            />
            <Legend
              formatter={(value) => (value === "expected_receipts" ? "תקבולים צפויים" : "רזרבות פתוחות")}
            />
            <Bar dataKey="expected_receipts" fill="#1e5b8a" radius={[4, 4, 0, 0]} />
            <Line type="monotone" dataKey="open_reserves" stroke="#c0521f" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </Stack>
  );
}
