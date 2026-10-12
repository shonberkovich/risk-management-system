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

// The backend stores and returns timestamps as naive UTC ("2026-10-11T08:30:00", no
// offset — see backend/app/models.py `_utcnow`), which `new Date()` would read as *local*
// time. Treat an offset-less date-time as UTC; date-only values ("2026-10-11") and
// strings that already carry "Z"/an offset are parsed as-is.
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

export const parseServerDate = (value: string) => new Date(NAIVE_DATETIME.test(value) ? `${value}Z` : value);

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local "YYYY-MM-DDTHH:mm" — the value format of `<input type="datetime-local">`
 * (`toISOString().slice(0, 16)` would give UTC wall-clock time instead). */
export const toDatetimeLocalValue = (date: Date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

/** Today's local calendar date as "YYYY-MM-DD" (`toISOString()` gives the UTC date,
 * which is still "yesterday" between local midnight and 02:00/03:00 in Israel). */
export const todayLocalIsoDate = () => toDatetimeLocalValue(new Date()).slice(0, 10);

export const formatDate = (value: string) =>
  parseServerDate(value).toLocaleDateString("he-IL", { year: "numeric", month: "2-digit", day: "2-digit" });

export const formatDateTime = (value: string) =>
  parseServerDate(value).toLocaleString("he-IL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

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

const CLAIM_STATUS_ORDER = ["DRAFT", "SUBMITTED", "IN_ADJUSTMENT", "APPROVED"];

/** The statuses a claim can be set to from `current` (itself included), mirroring
 * backend routers/claims.py _transition_allowed: forward only (a review step may be
 * skipped), SETTLED only after APPROVED, REJECTED while nothing has been paid. */
export function claimStatusOptions(current: string, paidAmount: number): string[] {
  if (current === "SETTLED" || current === "REJECTED") return [current];
  const forward = CLAIM_STATUS_ORDER.slice(Math.max(CLAIM_STATUS_ORDER.indexOf(current), 0));
  return [...forward, ...(paidAmount > 0 ? [] : ["REJECTED"]), ...(current === "APPROVED" ? ["SETTLED"] : [])];
}

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

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "מנהל מערכת",
  RISK_MANAGER: "מנהל סיכונים",
  RISK_OFFICER: "קצין סיכונים",
  PROPERTY_MANAGER: "מנהל נכסים",
  FIELD_WORKER: "עובד שטח",
  CFO: "סמנכ\"ל כספים",
  ADJUSTER: "שמאי",
};

export const SEVERITY_COLORS: Record<string, "success" | "warning" | "error" | "default"> = {
  LOW: "success",
  MEDIUM: "warning",
  HIGH: "error",
  CRITICAL: "error",
};

/** Same shape rule as the backend (schemas._EMAIL_RE): one "@", a dot in the domain, no spaces. */
export const isValidEmail = (value: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);

/** Same rule as the backend (schemas._valid_phone_or_empty): digits with spaces, dashes or
 * parentheses, an optional leading "+", 7-15 digits. */
export const isValidPhone = (value: string) =>
  /^\+?[\d\s()-]+$/.test(value) && (value.match(/\d/g)?.length ?? 0) >= 7 && (value.match(/\d/g)?.length ?? 0) <= 15;

/** Minimum length for a new password (schemas._valid_new_password). */
export const MIN_PASSWORD_LENGTH = 8;
