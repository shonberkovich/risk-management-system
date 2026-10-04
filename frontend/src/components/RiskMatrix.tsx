import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Fragment } from "react";

import type { RiskMatrixCell } from "../api/client";
import { ease, fonts, neon } from "../ui/tokens";

const BAND_LABELS: Record<string, string> = { low: "נמוכה", medium: "בינונית", high: "גבוהה" };
const PROB_ORDER = ["high", "medium", "low"] as const; // top row = highest probability
const SEV_ORDER = ["low", "medium", "high"] as const;

function cellColor(prob: string, sev: string, count: number) {
  if (count === 0) return "rgba(238, 241, 255, 0.04)";
  const riskLevel = (PROB_ORDER.indexOf(prob as any) === 0 ? 2 : PROB_ORDER.indexOf(prob as any) === 1 ? 1 : 0) +
    (SEV_ORDER.indexOf(sev as any));
  if (riskLevel >= 3) return neon.critical;
  if (riskLevel >= 2) return neon.high;
  return neon.medium;
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
      <Box sx={{ display: "grid", gridTemplateColumns: "64px repeat(3, 1fr)", gap: 1 }}>
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
                    data-testid={`risk-matrix-cell-${prob}-${sev}`}
                    data-count={count}
                    sx={{
                      position: "relative",
                      overflow: "hidden",
                      bgcolor: cellColor(prob, sev, count),
                      backgroundImage:
                        count > 0
                          ? "linear-gradient(145deg, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0) 45%, rgba(0,0,0,0.22) 100%)"
                          : "none",
                      border: count > 0 ? "1px solid rgba(255,255,255,0.22)" : "1px dashed rgba(148,163,255,0.16)",
                      borderRadius: "14px",
                      height: { xs: 52, sm: 60 },
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: count > 0 ? "pointer" : "default",
                      boxShadow:
                        count > 0
                          ? `0 10px 30px -10px ${cellColor(prob, sev, count)}, inset 0 1px 0 rgba(255,255,255,0.35)`
                          : "none",
                      transition: `transform 0.5s ${ease.spring}, box-shadow 0.5s ${ease.out}, filter 0.4s`,
                      outline: isSelected ? "2px solid" : "none",
                      outlineColor: "#fff",
                      outlineOffset: "3px",
                      ...(isSelected && { transform: "translateY(-3px) scale(1.04)", filter: "brightness(1.12)" }),
                      "&:hover":
                        count > 0
                          ? {
                              transform: "perspective(400px) translateZ(18px) rotateX(6deg)",
                              filter: "brightness(1.15)",
                              boxShadow: `0 20px 40px -10px ${cellColor(prob, sev, count)}, inset 0 1px 0 rgba(255,255,255,0.4)`,
                            }
                          : undefined,
                    }}
                  >
                    <Typography
                      sx={{
                        fontFamily: fonts.numeric,
                        fontSize: "1.25rem",
                        fontWeight: 700,
                        color: count > 0 ? "rgba(5, 8, 23, 0.92)" : "text.disabled",
                        textShadow: count > 0 ? "0 1px 0 rgba(255,255,255,0.35)" : "none",
                      }}
                    >
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
