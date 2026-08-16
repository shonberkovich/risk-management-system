import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Fragment } from "react";

import type { RiskMatrixCell } from "../api/client";

const BAND_LABELS: Record<string, string> = { low: "נמוכה", medium: "בינונית", high: "גבוהה" };
const PROB_ORDER = ["high", "medium", "low"] as const; // top row = highest probability
const SEV_ORDER = ["low", "medium", "high"] as const;

function cellColor(prob: string, sev: string, count: number) {
  if (count === 0) return "#eef1f4";
  const riskLevel = (PROB_ORDER.indexOf(prob as any) === 0 ? 2 : PROB_ORDER.indexOf(prob as any) === 1 ? 1 : 0) +
    (SEV_ORDER.indexOf(sev as any));
  if (riskLevel >= 3) return "#c62828";
  if (riskLevel >= 2) return "#e69413";
  return "#f2c14e";
}

export default function RiskMatrix({
  cells,
  selectedCell,
  onSelectCell,
}: {
  cells: RiskMatrixCell[];
  selectedCell?: RiskMatrixCell | null;
  onSelectCell?: (cell: RiskMatrixCell | null) => void;
}) {
  const getCell = (prob: string, sev: string) => cells.find((c) => c.probability_band === prob && c.severity_band === sev);

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
        מטריצת סיכונים — הסתברות מול חומרה
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "70px repeat(3, 1fr)", gap: 0.5 }}>
        <Box />
        {SEV_ORDER.map((sev) => (
          <Typography key={sev} variant="caption" textAlign="center" sx={{ fontWeight: 600 }}>
            {BAND_LABELS[sev]}
          </Typography>
        ))}
        {PROB_ORDER.map((prob) => (
          <Fragment key={prob}>
            <Typography variant="caption" sx={{ fontWeight: 600, alignSelf: "center" }}>
              {BAND_LABELS[prob]}
            </Typography>
            {SEV_ORDER.map((sev) => {
              const cell = getCell(prob, sev);
              const count = cell?.count ?? 0;
              const isSelected = selectedCell?.probability_band === prob && selectedCell?.severity_band === sev;
              return (
                <Tooltip
                  key={`${prob}-${sev}`}
                  title={
                    count > 0
                      ? `הסתברות ${BAND_LABELS[prob]} × חומרה ${BAND_LABELS[sev]}: ${count} נכסים (לחיצה לסינון)`
                      : `הסתברות ${BAND_LABELS[prob]} × חומרה ${BAND_LABELS[sev]}: 0 נכסים`
                  }
                >
                  <Box
                    onClick={() => {
                      if (!onSelectCell || count === 0 || !cell) return;
                      onSelectCell(isSelected ? null : cell);
                    }}
                    sx={{
                      bgcolor: cellColor(prob, sev, count),
                      borderRadius: 1,
                      height: 56,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: count > 0 ? "pointer" : "default",
                      transition: "transform 0.15s",
                      outline: isSelected ? "3px solid" : "none",
                      outlineColor: "primary.main",
                      outlineOffset: "2px",
                      "&:hover": count > 0 ? { transform: "scale(1.05)" } : undefined,
                    }}
                  >
                    <Typography sx={{ fontWeight: 800, color: count > 0 ? "white" : "text.disabled" }}>
                      {count}
                    </Typography>
                  </Box>
                </Tooltip>
              );
            })}
          </Fragment>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary" display="block" textAlign="center" sx={{ mt: 1 }}>
        חומרה →
      </Typography>
    </Box>
  );
}
