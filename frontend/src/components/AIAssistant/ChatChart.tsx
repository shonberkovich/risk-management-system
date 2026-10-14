import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useId, useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ChatChart as ChatChartData } from "../../api/client";
import { formatIls, formatIlsCompact } from "../../format";
import { useTokens } from "../../ui/useTokens";

const compactNumber = new Intl.NumberFormat("he-IL", { notation: "compact", maximumFractionDigits: 1 });
const fullNumber = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 2 });

/** Axis-tick and tooltip formatters for the chart's unit. */
function valueFormatters(unit: string): { tick: (v: number) => string; value: (v: number) => string } {
  if (unit === "₪") return { tick: formatIlsCompact, value: formatIls };
  if (unit === "%") return { tick: (v) => `${compactNumber.format(v)}%`, value: (v) => `${fullNumber.format(v)}%` };
  const suffix = unit ? ` ${unit}` : "";
  return { tick: (v) => compactNumber.format(v), value: (v) => `${fullNumber.format(v)}${suffix}` };
}

const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// On a wrapping div, not on the <table> itself: a table box ignores height/overflow,
// so its rows would still stretch the chat's scroll area.
const visuallyHidden = {
  position: "absolute",
  width: "1px",
  height: "1px",
  margin: "-1px",
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

/** A chart the AI assistant drew with its show_chart tool (backend
 * services/chat_charts.py), rendered inside the answer bubble: bar / line / pie over
 * the bubble's full width, with tooltips. Same chrome as the dashboard charts (the
 * global Recharts rules in ui/spatial.css) and series colors from useTokens(), so it
 * follows the light/dark toggle. A visually hidden table carries the same numbers for
 * screen readers. */
export default function ChatChart({ chart }: { chart: ChatChartData }) {
  const theme = useTheme();
  const { seriesPalette } = useTokens();
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const gradientId = `rmis-chat-chart-${useId().replace(/:/g, "")}`;
  const format = valueFormatters(chart.unit);
  const color = (i: number) => seriesPalette[i % seriesPalette.length];
  const rows = useMemo(
    () =>
      chart.points.map((p) => ({
        label: p.label,
        ...Object.fromEntries(chart.series.map((_, i) => [`s${i}`, p.values[i] ?? null])),
      })),
    [chart]
  );
  const multiSeries = chart.series.length > 1;
  const animation = { isAnimationActive: !reduceMotion, animationDuration: 900, animationEasing: "ease-out" as const };
  const tooltip = (
    <Tooltip
      contentStyle={{ direction: "rtl", fontFamily: theme.typography.fontFamily }}
      // Pie entries carry no series color, so give them the body text color.
      itemStyle={chart.chart_type === "pie" ? { color: theme.palette.text.primary } : undefined}
      formatter={(value: number, name: string) => [format.value(Number(value)), name]}
    />
  );
  const yLabel = chart.y_label && chart.unit && !chart.y_label.includes(chart.unit)
    ? `${chart.y_label} (${chart.unit})`
    : chart.y_label;
  const caption = [yLabel, chart.x_label].filter(Boolean).join(" · ");
  const cartesian = (
    <>
      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.palette.divider} />
      <XAxis dataKey="label" tickFormatter={(v: string) => shorten(String(v), 10)} tick={{ fontSize: 11 }} minTickGap={4} />
      <YAxis tickFormatter={(v: number) => format.tick(v)} tick={{ fontSize: 11 }} width={50} />
      {tooltip}
      {multiSeries && <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
    </>
  );

  return (
    <Box
      role="figure"
      aria-label={chart.title}
      sx={{
        mt: 1,
        p: 1.25,
        pb: 0.75,
        borderRadius: "14px",
        border: "1px solid",
        borderColor: "divider",
        bgcolor: alpha(theme.palette.background.paper, theme.palette.mode === "dark" ? 0.35 : 0.7),
        animation: "rmis-row-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) both",
      }}
    >
      <Typography variant="caption" component="div" sx={{ fontWeight: 700, fontSize: 12.5, color: "text.primary" }}>
        {chart.title}
      </Typography>
      {caption && (
        <Typography variant="caption" component="div" color="text.secondary" sx={{ fontSize: 11 }}>
          {caption}
        </Typography>
      )}
      <ResponsiveContainer width="100%" height={chart.chart_type === "pie" ? 230 : 200}>
        {chart.chart_type === "pie" ? (
          <PieChart>
            {tooltip}
            <Pie
              data={rows}
              dataKey="s0"
              nameKey="label"
              innerRadius="50%"
              outerRadius="78%"
              paddingAngle={2}
              {...animation}
            >
              {rows.map((_, i) => (
                <Cell key={i} fill={color(i)} />
              ))}
            </Pie>
            <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => shorten(String(v), 16)} />
          </PieChart>
        ) : chart.chart_type === "line" ? (
          <LineChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            {cartesian}
            {chart.series.map((name, i) => (
              <Line
                key={i}
                type="monotone"
                dataKey={`s${i}`}
                name={name}
                stroke={color(i)}
                strokeWidth={2.5}
                connectNulls
                dot={{ r: 3, fill: theme.palette.background.paper, stroke: color(i), strokeWidth: 2 }}
                activeDot={{ r: 5, fill: color(i), stroke: theme.palette.background.paper, strokeWidth: 2 }}
                {...animation}
              />
            ))}
          </LineChart>
        ) : (
          <BarChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              {chart.series.map((name, i) => (
                <linearGradient key={i} id={`${gradientId}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color(i)} stopOpacity={1} />
                  <stop offset="100%" stopColor={color(i)} stopOpacity={0.35} />
                </linearGradient>
              ))}
            </defs>
            {cartesian}
            {chart.series.map((name, i) => (
              <Bar
                key={i}
                dataKey={`s${i}`}
                name={name}
                fill={`url(#${gradientId}-${i})`}
                radius={[6, 6, 2, 2]}
                maxBarSize={multiSeries ? 22 : 36}
                {...animation}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
      <Box sx={visuallyHidden}>
        <table>
          <caption>{chart.title}</caption>
          <thead>
            <tr>
              <th scope="col">{chart.x_label}</th>
              {chart.series.map((name, i) => (
                <th key={i} scope="col">{name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.points.map((p, row) => (
              <tr key={row}>
                <th scope="row">{p.label}</th>
                {chart.series.map((name, i) => (
                  <td key={i}>{p.values[i] == null ? "—" : format.value(p.values[i] as number)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </Box>
  );
}
