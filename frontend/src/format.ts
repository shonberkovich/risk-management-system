const ilsFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

export const formatIls = (value: number) => ilsFormatter.format(value);

export const formatIlsCompact = (value: number) => {
  if (Math.abs(value) >= 1_000_000_000) return `₪${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `₪${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `₪${(value / 1_000).toFixed(0)}K`;
  return formatIls(value);
};

export const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

export const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("he-IL", { year: "numeric", month: "2-digit", day: "2-digit" });

export const ASSET_TYPE_LABELS: Record<string, string> = {
  LOGISTICS_CENTER: "מרכז לוגיסטי",
  OFFICE_BUILDING: "מבנה משרדים",
  RETAIL: "מסחרי",
  INFRASTRUCTURE: "תשתית",
};

export const HAZARD_LABELS: Record<string, string> = {
  FLOOD: "הצפה",
  FIRE: "שריפה",
  STRUCTURAL_FAILURE: "כשל מבני",
  THEFT: "פריצה",
  ELECTRICAL: "תקלת חשמל",
  OTHER: "אחר",
};

export const SEVERITY_LABELS: Record<string, string> = {
  LOW: "נמוכה",
  MEDIUM: "בינונית",
  HIGH: "גבוהה",
  CRITICAL: "קריטית",
};

export const OPERATIONAL_IMPACT_LABELS: Record<string, string> = {
  FULL_OPERATION: "פעיל כרגיל",
  PARTIAL_SHUTDOWN: "השבתה חלקית",
  FULL_SHUTDOWN: "השבתה מלאה",
};

export const INCIDENT_STATUS_LABELS: Record<string, string> = {
  NEW: "חדש",
  UNDER_INVESTIGATION: "בבדיקה",
  CLAIM_FILED: "תביעה הוגשה",
  CLOSED: "סגור",
};

export const CLAIM_STATUS_LABELS: Record<string, string> = {
  DRAFT: "טיוטה",
  SUBMITTED: "הוגשה",
  IN_ADJUSTMENT: "בבירור שמאים",
  APPROVED: "אושרה",
  REJECTED: "נדחתה",
  SETTLED: "נסגרה",
};

export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  ADVANCE: "מקדמה",
  FINAL_SETTLEMENT: "סילוק סופי",
};

export const MITIGATION_STATUS_LABELS: Record<string, string> = {
  OPEN: "פתוחה",
  IN_PROGRESS: "בטיפול",
  COMPLETED: "הושלמה",
  OVERDUE: "באיחור",
};

export const POLICY_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "פעילה",
  EXPIRED: "פגה תוקף",
  PENDING_RENEWAL: "ממתינה לחידוש",
};

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  POLICY_DOCUMENT: "פוליסת ביטוח",
  ADJUSTER_REPORT: "דוח שמאי",
  CORRESPONDENCE: "תכתובת",
  PHOTO: "תמונה",
  SURVEY_REPORT: "דוח סקר",
};

export const SEVERITY_COLORS: Record<string, "success" | "warning" | "error" | "default"> = {
  LOW: "success",
  MEDIUM: "warning",
  HIGH: "error",
  CRITICAL: "error",
};
