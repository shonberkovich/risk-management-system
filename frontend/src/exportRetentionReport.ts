import * as XLSX from "xlsx";

import type { Property, RetentionRecommendation } from "./api/client";
import { formatDate } from "./format";

/** Client-side Excel export of a single "absorb vs. claim" retention recommendation
 * (TODO_SPEC.md §8, "ייצוא ל-Excel") — same pattern as exportClaims.ts/
 * exportExposureReport.ts. One row per cost-model line item so the export reads as a
 * small comparison table, not just a dump of the API response. */
export function exportRetentionReportToExcel(
  property: Property,
  data: RetentionRecommendation,
  filename = `retention-report-${property.property_code}-${new Date().toISOString().slice(0, 10)}.xlsx`,
) {
  const rows = [
    { שדה: "נכס", ערך: `${property.name} (${property.property_code})` },
    { שדה: "נזק משוער (₪)", ערך: data.estimated_loss },
    { שדה: "המלצה", ערך: data.recommendation === "ABSORB" ? "לספוג את הנזק עצמונית" : "להגיש תביעה" },
    { שדה: "חיסכון צפוי בבחירה המומלצת (₪)", ערך: data.estimated_savings },
    { שדה: "— ספיגה עצמית —", ערך: "" },
    { שדה: "עלות כוללת בספיגה עצמית (₪)", ערך: data.absorb_total_cost },
    { שדה: "— הגשת תביעה —", ערך: "" },
    { שדה: "השתתפות עצמית (₪)", ערך: data.deductible },
    { שדה: "סכום בר-החזר מהמבטח (₪)", ערך: data.claim_recoverable_amount },
    { שדה: "תשלום מכיס (₪)", ערך: data.claim_out_of_pocket },
    { שדה: "תוספת פרמיה עתידית צפויה (₪)", ערך: data.expected_premium_surcharge },
    { שדה: "עלות כוללת בהגשת תביעה (₪)", ערך: data.claim_total_cost },
    { שדה: "הופק בתאריך", ערך: formatDate(new Date().toISOString()) },
  ];

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [{ wch: 34 }, { wch: 28 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "השתתפות עצמית");
  XLSX.writeFile(workbook, filename);
}
