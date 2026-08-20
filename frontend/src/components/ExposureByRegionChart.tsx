import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { RegionExposure } from "../api/client";
import { formatIlsCompact } from "../format";

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
            <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={(v) => formatIlsCompact(v)} tick={{ fontSize: 11 }} width={56} />
            <Tooltip
              contentStyle={{ direction: "rtl", fontFamily: theme.typography.fontFamily }}
              formatter={(value: number) => formatIlsCompact(value)}
            />
            <Legend formatter={(value) => (value === "tiv" ? "שווי מבוטח (TIV)" : "חשיפה מקסימלית (MFL)")} />
            <Bar dataKey="tiv" name="tiv" fill="#1e5b8a" />
            <Bar dataKey="mfl" name="mfl" fill="#e69413" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
