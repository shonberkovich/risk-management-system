import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { RegionExposure } from "../api/client";
import { formatIlsCompact } from "../format";
import { neon, seriesPalette } from "../ui/tokens";

/** Grouped TIV/MFL bar chart per geographic region (TODO_SPEC.md §8, "פילוח חשיפה
 * בדוח הנהלה") — GET /analytics/exposure-by-region was already fetched in Reports.tsx
 * (feeding the PDF-only ExecutiveReportPrintable table) but had no on-screen
 * visualization of its own; this is that missing piece. */
export default function ExposureByRegionChart({ data }: { data: RegionExposure[] }) {
  const theme = useTheme();
  const chartData = data.map((d) => ({ name: d.region_name, tiv: d.tiv, mfl: d.mfl }));

  return (
    <div>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
        פילוח חשיפה לפי אזור גיאוגרפי
      </Typography>
      {chartData.length === 0 ? (
        <Typography color="text.secondary" variant="body2">
          אין נתוני חשיפה זמינים.
        </Typography>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="rmis-region-tiv" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={neon.violet} stopOpacity={1} />
                <stop offset="100%" stopColor={neon.violet} stopOpacity={0.3} />
              </linearGradient>
              <linearGradient id="rmis-region-mfl" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={neon.medium} stopOpacity={1} />
                <stop offset="100%" stopColor={neon.high} stopOpacity={0.35} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={(v) => formatIlsCompact(v)} tick={{ fontSize: 11 }} width={56} />
            <Tooltip
              contentStyle={{ direction: "rtl", fontFamily: theme.typography.fontFamily }}
              formatter={(value: number) => formatIlsCompact(value)}
            />
            <Legend formatter={(value) => (value === "tiv" ? "שווי מבוטח (TIV)" : "חשיפה מקסימלית (MFL)")} />
            <Bar dataKey="tiv" name="tiv" fill="url(#rmis-region-tiv)" radius={[8, 8, 2, 2]} maxBarSize={40} />
            <Bar dataKey="mfl" name="mfl" fill="url(#rmis-region-mfl)" radius={[8, 8, 2, 2]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
