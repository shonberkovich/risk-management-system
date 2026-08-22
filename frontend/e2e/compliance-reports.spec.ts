import { expect, test } from "@playwright/test";

import { ROLE_CREDENTIALS, login } from "./helpers";

// E2E coverage for Compliance (ISO 31000 report) and Reports/Financials — real browser +
// real backend + real DB.
//
// Role sets read straight from backend source rather than guessed:
//   backend/app/routers/compliance.py  _COMPLIANCE_ROLES  = (RISK_MANAGER, RISK_OFFICER, CFO, ADMIN)
//   backend/app/routers/financials.py  _FINANCIALS_ROLES  = (RISK_MANAGER, CFO, ADMIN)
//
// Reports.tsx also renders an AI chat panel ("שאל את הנתונים") and an AI executive-summary
// button ("הפק דוח") — both call /api/ai/*, which this spec deliberately never clicks.

test.describe("Compliance (ISO 31000 report)", () => {
  test("RISK_OFFICER (in _COMPLIANCE_ROLES) sees the report load with its summary, framework sections, and risk entries", async ({
    page,
  }) => {
    await login(page, ROLE_CREDENTIALS.RISK_OFFICER);
    await page.goto("/compliance");
    await expect(page.getByRole("heading", { name: "דוח תאימות רגולטורית" })).toBeVisible({ timeout: 15_000 });

    // Summary KPI cards. ".first()" on the two labels that are also legitimately reused
    // (exact or as a substring) as a framework-section metric_label further down the same
    // page — DOM order puts the summary KPI grid before the framework-sections card, so
    // "first" reliably targets the KPI card rather than the later occurrence.
    await expect(page.getByText("כיסוי סקרי סיכונים").first()).toBeVisible();
    await expect(page.getByText("נכסים בסיכון גבוה/קריטי")).toBeVisible();
    await expect(page.getByText("שיעור השלמת בקרות").first()).toBeVisible();
    await expect(page.getByText("בקרות באיחור")).toBeVisible();

    // Framework sections card.
    await expect(page.getByText(/מיפוי לתהליכי ניהול סיכונים ותאימות רגולטורית/)).toBeVisible();

    // Per-property risk entries card.
    await expect(page.getByText(/מיפוי סיכונים לפי נכס/)).toBeVisible();
  });

  test("FIELD_WORKER (not in _COMPLIANCE_ROLES) is blocked gracefully, not with a blank crash", async ({ page }) => {
    await login(page, ROLE_CREDENTIALS.FIELD_WORKER);
    await page.goto("/compliance");
    // Compliance.tsx has no client-side role gate — the query fires and the backend 403s,
    // which the page surfaces via its isError branch (a styled Alert), not a blank page or
    // an unhandled exception.
    await expect(
      page.getByText(/שגיאה בטעינת דוח התאימות\. ודא שיש לך הרשאה לצפות בדוח/),
    ).toBeVisible({ timeout: 15_000 });
    // No stray React error boundary / blank body.
    await expect(page.getByRole("heading", { name: "דוח תאימות רגולטורית" })).not.toBeVisible();
    await expect(page.locator("body")).not.toBeEmpty();
  });
});

test.describe("Reports / Financials", () => {
  test("CFO (in _FINANCIALS_ROLES) sees the reports page load with the regulatory report's trend content", async ({
    page,
  }) => {
    await login(page, ROLE_CREDENTIALS.CFO);
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "דוחות ותובנות AI" })).toBeVisible();

    // Executive summary card renders (without clicking "הפק דוח", which calls /api/ai/*).
    await expect(page.getByRole("heading", { name: "דוח הנהלה (Executive Summary)" })).toBeVisible();

    // Regulatory report card (backend/app/routers/financials.py::get_regulatory_report).
    await expect(page.getByRole("heading", { name: /דוח רגולטורי/ })).toBeVisible();
    await expect(page.getByText("יחס כושר פירעון (Solvency Ratio)")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("הון עצמי זמין (Own Funds)")).toBeVisible();
    // exact:true — "דרישת הון (SCR)" is also a substring of the reporting-year caption
    // above this KPI grid ("...דרישת הון (SCR) מבוססת סימולציית...").
    await expect(page.getByText("דרישת הון (SCR)", { exact: true })).toBeVisible();
    await expect(page.getByText("ריכוזיות חשיפה (MFL/TIV)")).toBeVisible();
    await expect(page.getByText(/סטטוס כושר פירעון:/)).toBeVisible();

    // No permission error shown for an allowed role.
    await expect(
      page.getByText(/שגיאה בטעינת הדוח הרגולטורי/),
    ).not.toBeVisible();
  });

  test("RISK_MANAGER (in _FINANCIALS_ROLES) also sees the regulatory report content load", async ({ page }) => {
    await login(page, ROLE_CREDENTIALS.RISK_MANAGER);
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "דוחות ותובנות AI" })).toBeVisible();
    await expect(page.getByText("יחס כושר פירעון (Solvency Ratio)")).toBeVisible({ timeout: 15_000 });
  });
});
