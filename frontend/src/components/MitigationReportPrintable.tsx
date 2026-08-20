import type { CSSProperties } from "react";

import type { MitigationRoiBreakdown } from "../api/client";
import { MITIGATION_STATUS_LABELS, formatIls } from "../format";
import type { MitigationRow } from "./MitigationTable";

/** Off-screen printable layout for the mitigation task list + ROI breakdown
 * (TODO_SPEC.md §8, "דוח הפחתת סיכון מודפס"), captured by exportElementToPdf — same
 * plain HTML/inline-styles approach as ExecutiveReportPrintable.tsx (not MUI, so
 * html2canvas renders it predictably; not shown on screen, positioned off-viewport by
 * the parent rather than display:none since html2canvas needs a laid-out element).
 * `roiByTaskId` is optional: the ROI/payback columns are simply omitted for a task if
 * its breakdown isn't available (e.g. no active policy — see MitigationRoiBreakdown's
 * has_active_policy), same graceful-degradation pattern as the executive report. */
export default function MitigationReportPrintable({
  rows,
  roiByTaskId,
  summary,
}: {
  rows: MitigationRow[];
  roiByTaskId?: Map<number, MitigationRoiBreakdown>;
  summary: {
    openOrOverdueCount: number;
    overdueCount: number;
    activeCost: number;
    totalSavings: number;
    avgRoi: number | null;
  };
}) {
  const cardStyle: CSSProperties = {
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "12px 16px",
    flex: "1 1 0",
  };
  const th: CSSProperties = { border: "1px solid #ddd", padding: "4px 6px", textAlign: "right" };
  const td: CSSProperties = { border: "1px solid #ddd", padding: "4px 6px" };

  return (
    <div dir="rtl" style={{ width: 760, padding: 24, fontFamily: "Arial, sans-serif", color: "#1a1a1a", background: "#fff" }}>
      <h1 style={{ fontSize: 22, marginBottom: 2 }}>דוח הפחתת סיכון (Mitigation) — RMIS</h1>
      <p style={{ fontSize: 12, color: "#666", marginTop: 0 }}>
        הופק בתאריך {new Date().toLocaleDateString("he-IL")} · {rows.length} משימות
      </p>

      <div style={{ display: "flex", gap: 12, margin: "16px 0" }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 11, color: "#666" }}>משימות פתוחות / באיחור</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {summary.openOrOverdueCount}
            {summary.overdueCount > 0 ? ` (${summary.overdueCount} באיחור)` : ""}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 11, color: "#666" }}>עלות משוערת כוללת (פתוחות)</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIls(summary.activeCost)}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 11, color: "#666" }}>חיסכון שנתי צפוי כולל</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIls(summary.totalSavings)}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 11, color: "#666" }}>ROI ממוצע</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {summary.avgRoi !== null ? `${summary.avgRoi.toFixed(1)}%` : "-"}
          </div>
        </div>
      </div>

      <h2 style={{ fontSize: 15, marginBottom: 6 }}>משימות ותשואה (ROI)</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ background: "#f0f0f0" }}>
            {["משימה", "נכס", "סטטוס", "תאריך יעד", "עלות", "חיסכון שנתי", "ROI", "החזר השקעה (שנים)"].map((h) => (
              <th key={h} style={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const roi = roiByTaskId?.get(r.task_id);
            return (
              <tr key={r.task_id}>
                <td style={td}>{r.title}</td>
                <td style={td}>{r.property_name}</td>
                <td style={td}>{MITIGATION_STATUS_LABELS[r.status] ?? r.status}</td>
                <td style={td}>{new Date(r.due_date).toLocaleDateString("he-IL")}</td>
                <td style={td}>{formatIls(r.cost_estimate)}</td>
                <td style={td}>{formatIls(roi?.expected_annual_savings_total ?? r.expected_annual_savings)}</td>
                <td style={td}>{(roi?.roi_percent ?? r.roi_percent) !== null ? `${(roi?.roi_percent ?? r.roi_percent)}%` : "-"}</td>
                <td style={td}>{roi?.payback_years ?? "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
