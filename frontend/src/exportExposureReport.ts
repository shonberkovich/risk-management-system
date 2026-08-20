import * as XLSX from "xlsx";

import type { MultiYearTrend, RegionExposure } from "./api/client";
import { formatDate } from "./format";

/** Client-side Excel export of the periodic exposure report (TODO_SPEC.md §8, "ייצוא
 * ל-Excel") — mirrors exportClaims.ts's pattern (json_to_sheet, one sheet per logical
 * table, Hebrew column headers, enum values pre-translated). Two sheets: exposure by
 * region (TIV/MFL/claimed totals — GET /analytics/exposure-by-region) and, when
 * available, the multi-year financial trend already shown in Reports.tsx's regulatory
 * report card, so the workbook stands on its own without needing the on-screen table. */
export function exportExposureReportToExcel(
  regions: RegionExposure[],
  trends?: MultiYearTrend[],
  filename = `exposure-report-${new Date().toISOString().slice(0, 10)}.xlsx`,
) {
  const workbook = XLSX.utils.book_new();

  const regionRows = regions.map((r) => ({
    אזור: r.region_name,
    "שווי מבוטח (TIV)": r.tiv,
    "חשיפה מקסימלית (MFL)": r.mfl,
    "סה\"כ נתבע": r.total_claimed,
  }));
  const regionSheet = XLSX.utils.json_to_sheet(regionRows);
  regionSheet["!cols"] = Object.keys(regionRows[0] ?? {}).map(() => ({ wch: 20 }));
  XLSX.utils.book_append_sheet(workbook, regionSheet, "חשיפה לפי אזור");

  if (trends && trends.length > 0) {
    const trendRows = trends.map((t) => ({
      שנה: t.year,
      הכנסות: t.revenue,
      "רווח נקי": t.net_income,
      "הוצאות ביטוח": t.insurance_expense,
      "נזקים ששולמו": t.claim_losses_paid,
      "יחס נזקים (Loss Ratio)": t.loss_ratio,
      "הוצאת ביטוח/הכנסות": t.insurance_expense_to_revenue,
    }));
    const trendSheet = XLSX.utils.json_to_sheet(trendRows);
    trendSheet["!cols"] = Object.keys(trendRows[0] ?? {}).map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(workbook, trendSheet, "מגמה רב-שנתית");
  }

  const metaSheet = XLSX.utils.json_to_sheet([{ "הופק בתאריך": formatDate(new Date().toISOString()) }]);
  XLSX.utils.book_append_sheet(workbook, metaSheet, "מטא-דאטה");

  XLSX.writeFile(workbook, filename);
}
