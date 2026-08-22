import { expect, test } from "@playwright/test";

import { ROLE_CREDENTIALS, login } from "./helpers";

// E2E coverage for the Executive Dashboard (Dashboard.tsx's ExecutiveDashboard) and the
// Field Worker Dashboard (FieldWorkerDashboard.tsx) — Dashboard.tsx routes "/" to one or the
// other purely based on role (FIELD_WORKER has no server-side read access to the financial
// data the executive view is built around — see routers/analytics.py's _FINANCIAL_READ_ROLES).
//
// Deliberately does NOT assert on weather-alerts / Home Front Command banner content (both
// call real external APIs) — only that the rest of the dashboard (KPIs, map, risk matrix,
// charts, claims table) renders. Also does not touch the AI Assistant widget.
//
// Requires a real backend + seeded LocalDB running alongside the frontend dev server (see
// playwright.config.ts's header comment).

test.describe("Executive Dashboard", () => {
  test("loads KPIs, map, risk matrix, charts and claims table for a non-field-worker role", async ({ page }) => {
    await login(page, ROLE_CREDENTIALS.RISK_MANAGER);

    await expect(page.getByRole("heading", { name: "דשבורד מנהלים" })).toBeVisible({ timeout: 15_000 });

    // --- KPI cards ---
    await expect(page.getByText("סך שווי מבוטח (TIV)")).toBeVisible();
    await expect(page.getByText("חשיפה מקסימלית (MFL)")).toBeVisible();
    // exact: true — "סך תקבולים צפויים (תביעות פתוחות)" in the cashflow chart below also
    // contains this substring.
    await expect(page.getByText("תביעות פתוחות", { exact: true })).toBeVisible();
    // exact: true — the loss-ratio trend chart's own heading below also contains this substring.
    await expect(page.getByText("יחס נזקים (Loss Ratio)", { exact: true })).toBeVisible();

    // --- Risk map ---
    await expect(page.getByText("מפת חשיפה מרחבית ואירועים")).toBeVisible();
    // react-leaflet always renders this container class once the map mounts, regardless of
    // how many markers actually load — a stable signal the map component itself rendered.
    await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/^נכסים$/)).toBeVisible();
    await expect(page.getByText(/אירועים פעילים/)).toBeVisible();

    // --- Risk matrix + hazard distribution chart ---
    await expect(page.getByText("מטריצת סיכונים — הסתברות מול חומרה")).toBeVisible();
    await expect(page.getByText("התפלגות נזקים לפי סוג")).toBeVisible();

    // --- Loss ratio trend + cashflow charts ---
    await expect(page.getByText("מגמת יחס נזקים (Loss Ratio) רב-שנתית")).toBeVisible();
    await expect(page.getByText("תזרים צפוי ורזרבות פתוחות")).toBeVisible();

    // --- Claims table ---
    await expect(page.getByText("אירועים בטיפול וסטטוס תביעות ביטוח פתוחות")).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("clicking a populated risk-matrix cell filters the map and claims table, and can be cleared", async ({
    page,
  }) => {
    await login(page, ROLE_CREDENTIALS.ADMIN);
    await expect(page.getByRole("heading", { name: "דשבורד מנהלים" })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 15_000 });

    // RiskMatrix.tsx tags every cell with data-testid + a data-count attribute (added for this
    // spec) — find one with a non-zero count so clicking it actually does something, rather
    // than guessing which probability×severity band has data in the live, shared demo DB.
    const allCells = page.locator('[data-testid^="risk-matrix-cell-"]');
    const cellCount = await allCells.count();
    let targetCell = null;
    for (let i = 0; i < cellCount; i++) {
      const cell = allCells.nth(i);
      const count = await cell.getAttribute("data-count");
      if (count && count !== "0") {
        targetCell = cell;
        break;
      }
    }
    test.skip(targetCell === null, "No populated risk-matrix cell in the current demo data to click.");
    if (!targetCell) return;

    await targetCell.click();

    // Both filter chips (map card + claims table card) should appear once a cell is selected.
    await expect(page.getByText(/^מסונן: הסתברות/)).toBeVisible();
    await expect(page.getByText("מסונן לפי תא הסיכון שנבחר")).toBeVisible();

    // Clearing via the map card chip's delete (X) icon drops the filter from both places —
    // MUI's public `.MuiChip-deleteIcon` class is a stable target for the Chip's onDelete icon.
    await page
      .locator(".MuiChip-root", { hasText: /^מסונן: הסתברות/ })
      .locator(".MuiChip-deleteIcon")
      .click();
    await expect(page.getByText(/^מסונן: הסתברות/)).toBeHidden();
    await expect(page.getByText("מסונן לפי תא הסיכון שנבחר")).toBeHidden();
  });
});

test.describe("Field Worker Dashboard", () => {
  test("FIELD_WORKER lands on the reduced-scope dashboard, not the executive one", async ({ page }) => {
    await login(page, ROLE_CREDENTIALS.FIELD_WORKER);

    await expect(page.getByRole("heading", { name: "דשבורד שטח" })).toBeVisible({ timeout: 15_000 });
    // The executive dashboard's own heading/widgets must never render for this role.
    await expect(page.getByRole("heading", { name: "דשבורד מנהלים" })).toHaveCount(0);
    await expect(page.getByText("סך שווי מבוטח (TIV)")).toHaveCount(0);
    await expect(page.getByText("חשיפה מקסימלית (MFL)")).toHaveCount(0);
    await expect(page.locator(".leaflet-container")).toHaveCount(0);
    await expect(page.getByText("מטריצת סיכונים — הסתברות מול חומרה")).toHaveCount(0);

    // --- Online/offline status card ---
    await expect(page.getByText(/^(מחובר לרשת|לא מקוון)$/)).toBeVisible();

    // --- Report-incident shortcut navigates to /report-incident ---
    await page.getByRole("button", { name: "דיווח אירוע חדש" }).click();
    await expect(page).toHaveURL(/\/report-incident$/);
    await expect(page.getByRole("heading", { name: "דיווח על אירוע נזק חדש" })).toBeVisible();

    // --- Back to the field dashboard: recent-incidents list ---
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "דשבורד שטח" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("אירועים אחרונים")).toBeVisible();
  });
});
