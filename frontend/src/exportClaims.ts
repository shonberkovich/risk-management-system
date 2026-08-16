import * as XLSX from "xlsx";

import type { ClaimTrackingRow } from "./api/client";
import { CLAIM_STATUS_LABELS, HAZARD_LABELS, formatDate } from "./format";

/** Client-side export of the currently displayed claims rows to an .xlsx file.
 * No backend involved — mirrors what's on screen (including the derived
 * "paid_amount" field), with enum values translated to their Hebrew labels. */
export function exportClaimsToExcel(rows: ClaimTrackingRow[], filename = "claims-export.xlsx") {
  const sheetRows = rows.map((r) => ({
    "מס' תביעה": r.claim_number,
    נכס: r.property_name,
    "סוג נזק": HAZARD_LABELS[r.hazard_type] ?? r.hazard_type,
    "תאריך אירוע": formatDate(r.incident_date),
    "סכום נתבע": r.claimed_amount,
    "השתתפות עצמית": r.deductible_applied,
    "סכום מאושר": r.approved_amount,
    "שולם בפועל": r.paid_amount,
    סטטוס: CLAIM_STATUS_LABELS[r.claim_status] ?? r.claim_status,
    "צפי תשלום": r.expected_payment_date ? formatDate(r.expected_payment_date) : "",
  }));

  const worksheet = XLSX.utils.json_to_sheet(sheetRows);
  worksheet["!cols"] = Object.keys(sheetRows[0] ?? {}).map(() => ({ wch: 16 }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "תביעות");
  XLSX.writeFile(workbook, filename);
}
