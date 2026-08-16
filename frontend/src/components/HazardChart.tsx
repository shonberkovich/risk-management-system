import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type { HazardDistributionItem } from "../api/client";
import { HAZARD_LABELS } from "../format";

const COLORS = ["#1e5b8a", "#c62828", "#e69413", "#2e7d32", "#8e44ad", "#607d8b"];

export default function HazardChart({ data }: { data: HazardDistributionItem[] }) {
  const theme = useTheme();
  const chartData = data.map((d) => ({ name: HAZARD_LABELS[d.hazard_type] ?? d.hazard_type, value: d.count, percent: d.percent }));

  return (
    <div>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
        התפלגות נזקים לפי סוג
      </Typography>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={(d) => `${d.percent}%`}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ direction: "rtl", fontFamily: theme.typography.fontFamily }} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
