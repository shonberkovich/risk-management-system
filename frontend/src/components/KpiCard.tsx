import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

export default function KpiCard({
  label,
  value,
  subtext,
  trend,
  icon,
  accentColor,
}: {
  label: string;
  value: string;
  subtext?: string;
  trend?: "up" | "down";
  icon?: ReactNode;
  accentColor?: string;
}) {
  return (
    <Card variant="outlined" sx={{ height: "100%", borderTop: `4px solid ${accentColor ?? "#1e5b8a"}` }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              {label}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              {value}
            </Typography>
            {subtext && (
              <Stack direction="row" spacing={0.5} alignItems="center">
                {trend === "up" && <ArrowUpwardIcon fontSize="inherit" color="error" />}
                {trend === "down" && <ArrowDownwardIcon fontSize="inherit" color="success" />}
                <Typography variant="caption" color="text.secondary">
                  {subtext}
                </Typography>
              </Stack>
            )}
          </Stack>
          {icon}
        </Stack>
      </CardContent>
    </Card>
  );
}
