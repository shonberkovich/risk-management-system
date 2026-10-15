import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type { HazardDistributionItem } from "../api/client";
import { HAZARD_LABELS } from "../format";
import { useTokens } from "../ui/useTokens";

export default function HazardChart({ data }: { data: HazardDistributionItem[] }) {
  const theme = useTheme();
  const { seriesPalette: COLORS } = useTokens();
  const chartData = data.map((d) => ({ name: HAZARD_LABELS[d.hazard_type] ?? d.hazard_type, value: d.count, percent: d.percent }));

  return (
    <div>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
        התפלגות נזקים לפי סוג
      </Typography>
      {/* 280px: the legend wraps to two lines on phones and eats into the pie's area; at 240px
          the outside percentage labels (top/bottom slices) were clipped by the SVG edge. */}
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={44}
            outerRadius={74}
            paddingAngle={3}
            cornerRadius={6}
            stroke="none"
            label={(d) => `${d.percent}%`}
          >
            {chartData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} style={{ filter: `drop-shadow(0 0 6px ${COLORS[i % COLORS.length]}66)` }} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ direction: "rtl", fontFamily: theme.typography.fontFamily }} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
