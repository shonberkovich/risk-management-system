import { isAxiosError } from "axios";

// FastAPI errors come in two shapes: a router's HTTPException carries a string
// `detail` (already Hebrew for the user-facing ones), and request validation
// (422) carries a list of {loc, msg, type, ctx}. Pydantic's own messages are
// English, so the common types get a Hebrew sentence here; the schema's own
// validators already raise Hebrew text ("Value error, <text>").
interface ValidationIssue {
  loc?: (string | number)[];
  msg?: string;
  type?: string;
  ctx?: Record<string, unknown>;
}

function describeIssue(issue: ValidationIssue): string | null {
  const ctx = issue.ctx ?? {};
  switch (issue.type) {
    case "missing":
      return "שדה חובה";
    case "string_too_long":
      return `ארוך מדי (עד ${ctx.max_length} תווים)`;
    case "string_too_short":
      return "שדה חובה";
    case "greater_than_equal":
      return `חייב להיות ${ctx.ge} ומעלה`;
    case "greater_than":
      return `חייב להיות גדול מ-${ctx.gt}`;
    case "less_than_equal":
      return `חייב להיות ${ctx.le} לכל היותר`;
    case "less_than":
      return "הערך גדול מדי";
    case "literal_error":
      return "ערך לא חוקי";
    case "value_error":
      return issue.msg?.replace(/^Value error, /, "") ?? null;
    default:
      return null;
  }
}

const HEBREW = /[֐-׿]/;

/** A message to show for a failed request: the backend's own text when it is a
 * user-facing (Hebrew) one, a Hebrew description of the first invalid field on a
 * 422 (named through `fieldLabels` when given), otherwise `fallback`. English
 * details ("Property not found") are developer text, so they get the fallback. */
export function apiErrorMessage(
  err: unknown,
  fallback: string,
  fieldLabels: Record<string, string> = {},
): string {
  if (!isAxiosError(err)) return fallback;
  const detail = err.response?.data?.detail;
  if (typeof detail === "string") return HEBREW.test(detail) ? detail : fallback;
  if (Array.isArray(detail) && detail.length > 0) {
    const issue = detail[0] as ValidationIssue;
    const text = describeIssue(issue);
    if (!text) return fallback;
    const field = issue.loc?.[issue.loc.length - 1];
    const label = typeof field === "string" ? fieldLabels[field] : undefined;
    return label ? `${label}: ${text}` : text;
  }
  return fallback;
}
