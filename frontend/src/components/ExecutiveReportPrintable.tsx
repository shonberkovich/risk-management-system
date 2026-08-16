import type { CSSProperties } from "react";

import type { ClaimTrackingRow, KpiSummary } from "../api/client";
import { CLAIM_STATUS_LABELS, formatDate, formatIls, formatPercent } from "../format";

/** Off-screen printable layout captured by exportElementToPdf for the executive PDF
 * report (KPIs + claims table, and the AI executive summary text when available).
 * Kept as plain HTML/inline styles (not MUI) so html2canvas renders it predictably
 * regardless of theme/CSS-in-JS quirks. Not meant to be shown on screen — the parent
 * positions this off-viewport rather than `display: none` (html2canvas can't capture
 * an element that isn't actually laid out). */
export default function ExecutiveReportPrintable({
  kpis,
  claims,
  summaryText,
}: {
  kpis: KpiSummary;
  claims: ClaimTrackingRow[];
  summaryText?: string;
}) {
  const cardStyle: CSSProperties = {
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "12px 16px",
    flex: "1 1 0",
  };

  return (
    <div dir="rtl" style={{ width: 760, padding: 24, fontFamily: "Arial, sans-serif", color: "#1a1a1a", background: "#fff" }}>
      <h1 style={{ fontSize: 22, marginBottom: 2 }}>דוח הנהלה — RMIS</h1>
      <p style={{ fontSize: 12, color: "#666", marginTop: 0 }}>
        הופק בתאריך {new Date().toLocaleDateString("he-IL")}
      </p>

      <div style={{ display: "flex", gap: 12, margin: "16px 0" }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 11, color: "#666" }}>סך שווי מבוטח (TIV)</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIls(kpis.tiv)}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 11, color: "#666" }}>חשיפה מקסימלית (MFL)</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{formatIls(kpis.mfl)}</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 11, color: "#666" }}>תביעות פתוחות</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {kpis.open_claims_count} ({formatIls(kpis.open_claims_amount)})
          </div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 11, color: "#666" }}>יחס נזקים</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{formatPercent(kpis.loss_ratio)}</div>
        </div>
      </div>

      {summaryText && (
        <div style={{ margin: "16px 0" }}>
          <h2 style={{ fontSize: 15, marginBottom: 6 }}>תקציר מנהלים (AI)</h2>
          <p style={{ fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{summaryText}</p>
        </div>
      )}

      <h2 style={{ fontSize: 15, marginBottom: 6 }}>תביעות</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ background: "#f0f0f0" }}>
            {["מס' תביעה", "נכס", "תאריך אירוע", "סכום נתבע", "סכום מאושר", "שולם בפועל", "סטטוס"].map((h) => (
              <th key={h} style={{ border: "1px solid #ddd", padding: "4px 6px", textAlign: "right" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {claims.map((c) => (
            <tr key={c.claim_id}>
              <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>{c.claim_number}</td>
              <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>{c.property_name}</td>
              <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>{formatDate(c.incident_date)}</td>
              <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>{formatIls(c.claimed_amount)}</td>
              <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>{formatIls(c.approved_amount)}</td>
              <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>{formatIls(c.paid_amount)}</td>
              <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>
                {CLAIM_STATUS_LABELS[c.claim_status] ?? c.claim_status}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
