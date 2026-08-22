import { expect, test } from "@playwright/test";

import { ROLE_CREDENTIALS, login, uniqueMarker } from "./helpers";

// E2E coverage for /mitigation: role-gated create button + row actions, task creation
// (including the automatic OVERDUE-on-create behavior from backend/app/routers/
// mitigation.py's _sync_overdue), mark-complete, and the read-only ROI detail dialog.
// Role sets mirrored from mitigation.py's _MITIGATION_WRITE_ROLES = (RISK_MANAGER,
// PROPERTY_MANAGER, ADMIN); GET endpoints there are intentionally open to any
// authenticated role (no require_roles at all), so non-write roles can still see the list.
//
// Regression coverage for the RBAC fix in commit 1a9a432: create button + MitigationTable's
// edit/mark-complete row actions (and their whole "פעולות" column contents) must stay
// hidden for non-write roles; onShowRoi (read-only) must stay visible to everyone.
test.describe("Mitigation tasks", () => {
  test("write roles (RISK_MANAGER/PROPERTY_MANAGER/ADMIN) see the create button, others don't", async ({ page }) => {
    for (const role of ["RISK_MANAGER", "PROPERTY_MANAGER", "ADMIN"] as const) {
      await login(page, ROLE_CREDENTIALS[role]);
      await page.goto("/mitigation");
      await expect(page.getByRole("heading", { name: "משימות הפחתת סיכון" })).toBeVisible();
      await expect(page.getByRole("button", { name: "משימה חדשה" })).toBeVisible();
      await page.getByRole("button", { name: "ניווט" }).click();
      await page.getByRole("button", { name: "התנתקות" }).click();
      await expect(page.getByLabel("אימייל")).toBeVisible();
    }

    for (const role of ["CFO", "RISK_OFFICER", "ADJUSTER", "FIELD_WORKER"] as const) {
      await login(page, ROLE_CREDENTIALS[role]);
      await page.goto("/mitigation");
      await expect(page.getByRole("heading", { name: "משימות הפחתת סיכון" })).toBeVisible();
      await expect(page.getByRole("button", { name: "משימה חדשה" })).toBeHidden();
      await page.getByRole("button", { name: "ניווט" }).click();
      await page.getByRole("button", { name: "התנתקות" }).click();
      await expect(page.getByLabel("אימייל")).toBeVisible();
    }
  });

  test("a write role creates a task with a future due date, and it appears as OPEN", async ({ page }) => {
    const marker = uniqueMarker("E2E-MIT-OPEN");

    await login(page, "RISK_MANAGER");
    await page.goto("/mitigation");
    await page.getByRole("button", { name: "משימה חדשה" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByLabel("נכס").click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.getByLabel("כותרת המשימה").fill(marker);
    await page.getByLabel("עלות משוערת (₪)").fill("15000");
    await page.getByLabel("חיסכון שנתי צפוי (₪)").fill("3000");
    await page.getByLabel("תאריך יעד").fill("2030-06-15");

    await page.getByRole("button", { name: "יצירה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // .first(): Mitigation.tsx also renders an off-screen plain-HTML duplicate of this same
    // row (MitigationReportPrintable, for the PDF export button) later in the DOM — it isn't
    // display:none (html2canvas needs a laid-out element), so it's a second "tbody tr" match
    // for the same marker text. The on-screen MUI table renders first in source order.
    const row = page.locator("tbody tr", { hasText: marker }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("פתוחה");
  });

  test("a write role creates a task with a past due date, and it appears as OVERDUE automatically", async ({ page }) => {
    const marker = uniqueMarker("E2E-MIT-OVERDUE");

    await login(page, "RISK_MANAGER");
    await page.goto("/mitigation");
    await page.getByRole("button", { name: "משימה חדשה" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByLabel("נכס").click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.getByLabel("כותרת המשימה").fill(marker);
    await page.getByLabel("עלות משוערת (₪)").fill("8000");
    await page.getByLabel("חיסכון שנתי צפוי (₪)").fill("1000");
    // Well in the past — created OPEN server-side, then _sync_overdue immediately flips it
    // to OVERDUE in the same create_task request since due_date < today.
    await page.getByLabel("תאריך יעד").fill("2020-01-01");

    await page.getByRole("button", { name: "יצירה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // .first(): Mitigation.tsx also renders an off-screen plain-HTML duplicate of this same
    // row (MitigationReportPrintable, for the PDF export button) later in the DOM — it isn't
    // display:none (html2canvas needs a laid-out element), so it's a second "tbody tr" match
    // for the same marker text. The on-screen MUI table renders first in source order.
    const row = page.locator("tbody tr", { hasText: marker }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("באיחור");
  });

  test("a write role marks a task complete via the table action", async ({ page }) => {
    const marker = uniqueMarker("E2E-MIT-COMPLETE");

    await login(page, "RISK_MANAGER");
    await page.goto("/mitigation");
    await page.getByRole("button", { name: "משימה חדשה" }).click();
    await page.getByLabel("נכס").click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.getByLabel("כותרת המשימה").fill(marker);
    await page.getByLabel("עלות משוערת (₪)").fill("5000");
    await page.getByLabel("חיסכון שנתי צפוי (₪)").fill("500");
    await page.getByLabel("תאריך יעד").fill("2030-01-01");
    await page.getByRole("button", { name: "יצירה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // .first(): Mitigation.tsx also renders an off-screen plain-HTML duplicate of this same
    // row (MitigationReportPrintable, for the PDF export button) later in the DOM — it isn't
    // display:none (html2canvas needs a laid-out element), so it's a second "tbody tr" match
    // for the same marker text. The on-screen MUI table renders first in source order.
    const row = page.locator("tbody tr", { hasText: marker }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("פתוחה");

    // A far-future due_date sorts this OPEN task near the bottom of MitigationTable's
    // scrollable container (TableContainer sx={{ maxHeight: 480 }}, stickyHeader). The
    // native scrollIntoView the click would otherwise trigger can align the row flush
    // under the sticky <thead>, leaving the action button visually covered and the click
    // stuck retrying — so scroll it into the container's middle explicitly first, clear of
    // the sticky header, before interacting with its action buttons.
    await row.evaluate((el) => {
      const container = el.closest(".MuiTableContainer-root");
      if (container) {
        const rect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        container.scrollTop += rect.top - containerRect.top - containerRect.height / 2;
      }
    });

    // MUI icons carry a stable data-testid equal to their component name (see
    // Claims.test.tsx's precedent) — a more robust selector here than the Tooltip-derived
    // accessible name, which only doubles as the button's a11y name while the tooltip
    // popper itself is closed.
    await row.locator('button:has([data-testid="AssignmentTurnedInIcon"])').click();
    await expect(row).toContainText("הושלמה", { timeout: 15_000 });
    // The mark-complete icon becomes disabled once a task is COMPLETED (MitigationTable.tsx).
    await expect(row.locator('button:has([data-testid="AssignmentTurnedInIcon"])')).toBeDisabled();
  });

  test("a non-write role sees no create/edit/mark-complete actions, but still sees the ROI detail action", async ({ page }) => {
    await login(page, "CFO");
    await page.goto("/mitigation");
    await expect(page.getByRole("heading", { name: "משימות הפחתת סיכון" })).toBeVisible();
    await expect(page.getByRole("button", { name: "משימה חדשה" })).toBeHidden();

    // Wait for at least one row so the row-level action assertions below are meaningful.
    const anyRow = page.locator("tbody tr").first();
    await expect(anyRow).toBeVisible({ timeout: 15_000 });

    await expect(anyRow.getByRole("button", { name: "עריכה" })).toHaveCount(0);
    await expect(anyRow.getByRole("button", { name: /סימון כבוצע|המשימה כבר הושלמה/ })).toHaveCount(0);
    await expect(anyRow.getByRole("button", { name: "פירוט ROI" })).toBeVisible();
  });

  test("the ROI dialog renders the cost/savings/payback breakdown without error", async ({ page }) => {
    await login(page, "RISK_MANAGER");
    await page.goto("/mitigation");
    const anyRow = page.locator("tbody tr").first();
    await expect(anyRow).toBeVisible({ timeout: 15_000 });

    await anyRow.getByRole("button", { name: "פירוט ROI" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("עלות המשימה")).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText("חיסכון פרמיה צפוי")).toBeVisible();
    await expect(dialog.getByText("חיסכון אובדנים צפוי")).toBeVisible();
    await expect(dialog.getByText("סה״כ חיסכון שנתי צפוי")).toBeVisible();
    await expect(dialog.getByText("ROI", { exact: true })).toBeVisible();
    await expect(dialog.getByText("תקופת החזר השקעה")).toBeVisible();
    await expect(dialog.getByText("שגיאה בטעינת פירוט ה-ROI.")).toBeHidden();

    await dialog.getByRole("button", { name: "סגירה" }).click();
    await expect(dialog).toBeHidden();
  });
});
