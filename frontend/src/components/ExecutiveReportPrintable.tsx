import type { CSSProperties } from "react";

import type {
  ClaimTrackingRow,
  KpiSummary,
  MitigationRoiBreakdown,
  MultiYearTrend,
  PortfolioSimulationResult,
  RegionExposure,
  TrendSummary,
} from "../api/client";
import { CLAIM_STATUS_LABELS, MITIGATION_STATUS_LABELS, formatDate, formatIls, formatPercent } from "../format";

/** Off-screen printable layout captured by exportElementToPdf for the executive PDF
 * report (KPIs + claims table, and the AI executive summary text when available).
 * Kept as plain HTML/inline styles (not MUI) so html2canvas renders it predictably
 * regardless of theme/CSS-in-JS quirks. Not meant to be shown on screen — the parent
 * positions this off-viewport rather than `display: none` (html2canvas can't capture
 * an element that isn't actually laid out).
 *
 * `simulation`/`roiSummary`/`trends`/`trendSummary` are optional: the parent (Reports.tsx)
 * only renders this component once its *required* PDF data (kpis/claims/regions) has
 * loaded, but VaR/ROI/trend data come from separate queries that may still be pending or
 * may 404 (e.g. no mitigation tasks with a cost_estimate yet) — each section below is
 * simply omitted rather than blocking the whole export on data that isn't essential to it. */
export default function ExecutiveReportPrintable({
  kpis,
  claims,
  regions,
  summaryText,
  simulation,
  roiSummary,
  trends,
  trendSummary,
}: {
  kpis: KpiSummary;
  claims: ClaimTrackingRow[];
  regions: RegionExposure[];
  summaryText?: string;
  simulation?: PortfolioSimulationResult;
  roiSummary?: MitigationRoiBreakdown[];
  trends?: MultiYearTrend[];
  trendSummary?: TrendSummary | null;
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

      <h2 style={{ fontSize: 15, marginBottom: 6 }}>חשיפה לפי אזורים</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginBottom: 16 }}>
        <thead>
          <tr style={{ background: "#f0f0f0" }}>
            {["אזור", "שווי מבוטח (TIV)", "חשיפה מקסימלית (MFL)", "סך נתבע"].map((h) => (
              <th key={h} style={{ border: "1px solid #ddd", padding: "4px 6px", textAlign: "right" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {regions.map((r) => (
            <tr key={r.region_id ?? "unassigned"}>
              <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>{r.region_name}</td>
              <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>{formatIls(r.tiv)}</td>
              <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>{formatIls(r.mfl)}</td>
              <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>{formatIls(r.total_claimed)}</td>
            </tr>
          ))}
        </tbody>
      </table>

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

      {simulation && (
        <>
          <h2 style={{ fontSize: 15, marginBottom: 6, marginTop: 16 }}>
            סימולציית Monte Carlo ו-VaR ({simulation.iterations.toLocaleString("he-IL")} הדמיות, אופק {simulation.horizon_years} שנים)
          </h2>
          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            <div style={cardStyle}>
              <div style={{ fontSize: 11, color: "#666" }}>נזק שנתי צפוי</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{formatIls(simulation.expected_annual_loss)}</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 11, color: "#666" }}>VaR 95%</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{formatIls(simulation.var_95)}</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 11, color: "#666" }}>VaR 99%</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{formatIls(simulation.var_99)}</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 11, color: "#666" }}>תרחיש גרוע ביותר</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{formatIls(simulation.worst_case_simulated_loss)}</div>
            </div>
          </div>
        </>
      )}

      {roiSummary && roiSummary.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, marginBottom: 6 }}>ROI על משימות הפחתת סיכון (מיטיגציה)</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginBottom: 16 }}>
            <thead>
              <tr style={{ background: "#f0f0f0" }}>
                {["משימה", "סטטוס", "עלות", "חיסכון שנתי צפוי", "ROI", "החזר השקעה (שנים)"].map((h) => (
                  <th key={h} style={{ border: "1px solid #ddd", padding: "4px 6px", textAlign: "right" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roiSummary.map((r) => (
                <tr key={r.task_id}>
                  <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>{r.title}</td>
                  <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>
                    {MITIGATION_STATUS_LABELS[r.status] ?? r.status}
                  </td>
                  <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>{formatIls(r.cost_estimate)}</td>
                  <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>
                    {formatIls(r.expected_annual_savings_total)}
                  </td>
                  <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>
                    {r.roi_percent !== null ? `${r.roi_percent}%` : "-"}
                  </td>
                  <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>{r.payback_years ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {trends && trends.length > 0 && (
        <>
          <h2 style={{ fontSize: 15, marginBottom: 6 }}>ניתוח מגמות רב-שנתי</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginBottom: trendSummary ? 6 : 16 }}>
            <thead>
              <tr style={{ background: "#f0f0f0" }}>
                {["שנה", "הכנסות", "רווח נקי", "הוצאת ביטוח", "נזקים ששולמו", "יחס נזקים", "הוצ' ביטוח/הכנסות"].map((h) => (
                  <th key={h} style={{ border: "1px solid #ddd", padding: "4px 6px", textAlign: "right" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trends.map((t) => (
                <tr key={t.year}>
                  <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>{t.year}</td>
                  <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>{formatIls(t.revenue)}</td>
                  <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>{formatIls(t.net_income)}</td>
                  <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>{formatIls(t.insurance_expense)}</td>
                  <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>{formatIls(t.claim_losses_paid)}</td>
                  <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>
                    {t.loss_ratio !== null ? formatPercent(t.loss_ratio) : "-"}
                  </td>
                  <td style={{ border: "1px solid #ddd", padding: "4px 6px" }}>
                    {t.insurance_expense_to_revenue !== null ? formatPercent(t.insurance_expense_to_revenue) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {trendSummary && (
            <p style={{ fontSize: 11, color: "#444" }}>
              CAGR הכנסות: {trendSummary.revenue_cagr_pct ?? "-"}%
              {trendSummary.claim_losses_cagr_pct !== null && ` · CAGR נזקים ששולמו: ${trendSummary.claim_losses_cagr_pct}%`}
              {" · "}
              {trendSummary.cost_of_risk_outpacing_revenue
                ? "עלות הסיכון גדלה מהר יותר מההכנסות."
                : "עלות הסיכון אינה חורגת מקצב צמיחת ההכנסות."}
            </p>
          )}
        </>
      )}
    </div>
  );
}
