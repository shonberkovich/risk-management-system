import { expect, test } from "@playwright/test";

import { ROLE_CREDENTIALS, login, uniqueMarker } from "./helpers";

// E2E coverage for /policies: role-gated create button, policy creation, status filter,
// and policy-assets management. Role sets mirrored from backend/app/routers/policies.py's
// _POLICIES_WRITE_ROLES = (RISK_MANAGER, CFO, ADMIN) / _POLICIES_READ_ROLES (adds
// PROPERTY_MANAGER, RISK_OFFICER, ADJUSTER — everyone except FIELD_WORKER).
//
// Regression coverage for the RBAC fix in commit 1a9a432 ("Add test coverage for
// Properties/Claims/Policies/Mitigation/Dashboard; fix missing write-role gating"): the
// create button and PolicyTable's edit/manage-assets row actions (and their whole
// "פעולות" column) must stay hidden for non-write roles, not just fail server-side.
test.describe("Policies", () => {
  test("write roles (RISK_MANAGER/CFO/ADMIN) see the create button, others don't", async ({ page }) => {
    for (const role of ["RISK_MANAGER", "CFO", "ADMIN"] as const) {
      await login(page, ROLE_CREDENTIALS[role]);
      await page.goto("/policies");
      await expect(page.getByRole("heading", { name: "ניהול פוליסות ביטוח" })).toBeVisible();
      await expect(page.getByRole("button", { name: "פוליסה חדשה" })).toBeVisible();
      await page.getByRole("button", { name: "ניווט" }).click();
      await page.getByRole("button", { name: "התנתקות" }).click();
      await expect(page.getByLabel("אימייל")).toBeVisible();
    }

    // Non-write roles: RISK_OFFICER/ADJUSTER/PROPERTY_MANAGER can still read policies
    // (_POLICIES_READ_ROLES) but must not see the create button. FIELD_WORKER can't even
    // read policies server-side, so it's excluded from this loop (covered by the
    // manage-assets-hidden check below via a read-capable non-write role instead).
    for (const role of ["PROPERTY_MANAGER", "RISK_OFFICER", "ADJUSTER"] as const) {
      await login(page, ROLE_CREDENTIALS[role]);
      await page.goto("/policies");
      await expect(page.getByRole("heading", { name: "ניהול פוליסות ביטוח" })).toBeVisible();
      await expect(page.getByRole("button", { name: "פוליסה חדשה" })).toBeHidden();
      await page.getByRole("button", { name: "ניווט" }).click();
      await page.getByRole("button", { name: "התנתקות" }).click();
      await expect(page.getByLabel("אימייל")).toBeVisible();
    }
  });

  test("a write role creates a policy with a unique policy number, and it appears in the list", async ({ page }) => {
    const marker = uniqueMarker("E2E-POL");

    await login(page, "RISK_MANAGER");
    await page.goto("/policies");
    await page.getByRole("button", { name: "פוליסה חדשה" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.getByLabel("מספר פוליסה").fill(marker);
    await page.getByLabel("שם מבטח").fill("E2E Insurer Ltd.");
    await page.getByLabel("תחילת תוקף").fill("2026-01-01");
    await page.getByLabel("סוף תוקף").fill("2026-12-31");
    await page.getByLabel("תקרת כיסוי (₪)").fill("10000000");
    await page.getByLabel("השתתפות עצמית (₪)").fill("50000");
    await page.getByLabel("פרמיה שנתית (₪)").fill("120000");

    await page.getByRole("button", { name: "יצירה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    const row = page.locator("tbody tr", { hasText: marker });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText("E2E Insurer Ltd.");
    // Newly created policy defaults to ACTIVE (PolicyDialog's emptyForm.status).
    await expect(row).toContainText("פעילה");
  });

  test("status filter narrows the list to the selected status", async ({ page }) => {
    const marker = uniqueMarker("E2E-POL-FILTER");

    await login(page, "RISK_MANAGER");
    await page.goto("/policies");
    await page.getByRole("button", { name: "פוליסה חדשה" }).click();
    const createDialog = page.getByRole("dialog");
    await createDialog.getByLabel("מספר פוליסה").fill(marker);
    await createDialog.getByLabel("שם מבטח").fill("E2E Filter Insurer");
    await createDialog.getByLabel("תחילת תוקף").fill("2020-01-01");
    await createDialog.getByLabel("סוף תוקף").fill("2020-12-31");
    await createDialog.getByLabel("תקרת כיסוי (₪)").fill("1000000");
    await createDialog.getByLabel("השתתפות עצמית (₪)").fill("10000");
    await createDialog.getByLabel("פרמיה שנתית (₪)").fill("50000");
    // Set status explicitly to EXPIRED so this row is deterministically excluded by the
    // ACTIVE filter and included by the EXPIRED filter below. Scoped to the dialog since
    // the page's own status *filter* select shares the same "סטטוס" label and is still
    // present (though inert) behind the open MUI Dialog.
    await createDialog.getByLabel("סטטוס").click();
    await page.getByRole("option", { name: "פגה תוקף" }).click();
    await createDialog.getByRole("button", { name: "יצירה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    await expect(page.locator("tbody tr", { hasText: marker })).toBeVisible({ timeout: 15_000 });

    // Scoped to role "combobox" (not getByLabel) so this never matches the open MUI Menu's
    // own <ul role="listbox"> — which also carries an aria-labelledby pointing at the same
    // "סטטוס" label while it's open/mid-close-transition, and would otherwise throw a
    // strict-mode violation on the second/third reopen below.
    const statusFilter = page.getByRole("combobox", { name: /^סטטוס/ });

    // Filter to ACTIVE: our EXPIRED row must disappear.
    await statusFilter.click();
    await page.getByRole("option", { name: "פעילה", exact: true }).click();
    await expect(page.locator("tbody tr", { hasText: marker })).toHaveCount(0);

    // Filter to EXPIRED: our row must reappear.
    await statusFilter.click();
    await page.getByRole("option", { name: "פגה תוקף" }).click();
    await expect(page.locator("tbody tr", { hasText: marker })).toBeVisible();
  });

  test("a write role assigns a property to a policy via the policy-assets dialog", async ({ page }) => {
    const marker = uniqueMarker("E2E-POL-ASSETS");

    await login(page, "RISK_MANAGER");
    await page.goto("/policies");
    await page.getByRole("button", { name: "פוליסה חדשה" }).click();
    await page.getByLabel("מספר פוליסה").fill(marker);
    await page.getByLabel("שם מבטח").fill("E2E Assets Insurer");
    await page.getByLabel("תחילת תוקף").fill("2026-01-01");
    await page.getByLabel("סוף תוקף").fill("2026-12-31");
    await page.getByLabel("תקרת כיסוי (₪)").fill("5000000");
    await page.getByLabel("השתתפות עצמית (₪)").fill("20000");
    await page.getByLabel("פרמיה שנתית (₪)").fill("60000");
    await page.getByRole("button", { name: "יצירה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    const row = page.locator("tbody tr", { hasText: marker });
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByRole("button").first().click(); // "נכסים מבוטחים" is the first action icon (see PolicyTable.tsx)
    const assetsDialog = page.getByRole("dialog");
    await expect(assetsDialog).toBeVisible();
    // The marker also appears in the still-present (but inert) table cell behind the open
    // dialog, so scope to the dialog itself (its title includes the policy number).
    await expect(assetsDialog.getByText(marker)).toBeVisible();
    await expect(assetsDialog.getByText("אין עדיין נכסים משויכים לפוליסה זו.")).toBeVisible();

    await assetsDialog.getByLabel("הוספת נכס לפוליסה").click();
    await page.keyboard.press("ArrowDown");
    const optionText = await page.locator('[role="option"]').first().innerText();
    await page.keyboard.press("Enter");
    await assetsDialog.getByRole("button", { name: "הוסף" }).click();

    // The assigned property now appears in the dialog's list (matched by name, since
    // optionText is "name (property_code)" but the list item shows only the name).
    const propertyName = optionText.split(" (")[0];
    await expect(assetsDialog.getByText(propertyName, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(assetsDialog.getByText("אין עדיין נכסים משויכים לפוליסה זו.")).toBeHidden();

    await assetsDialog.getByRole("button", { name: "סגירה" }).click();
  });

  test("a non-write role does not see the manage-assets icon or actions column at all", async ({ page }) => {
    await login(page, "PROPERTY_MANAGER");
    await page.goto("/policies");
    await expect(page.getByRole("heading", { name: "ניהול פוליסות ביטוח" })).toBeVisible();
    // PolicyTable only renders the "פעולות" column header when at least one action prop is
    // passed — for a non-write role, neither onEdit nor onManageAssets is passed, so the
    // whole column (not just the icons) must be absent.
    await expect(page.getByRole("columnheader", { name: "פעולות" })).toBeHidden();
  });
});
