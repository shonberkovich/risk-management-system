import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { ROLE_CREDENTIALS, login, logout, uniqueMarker } from "./helpers";

/** Opens a MUI `select` TextField by its label and picks an option by name, then waits for
 * the popup listbox to fully detach before returning. MUI keeps the listbox mounted during
 * its exit transition, which — if this same field's label is reused again immediately (e.g.
 * "סינון לפי תפקיד" filter reused across sequential filter steps) — can transiently
 * strict-mode-collide with the label association since the still-detaching listbox portal
 * also carries the same aria-labelledby as the trigger. `scope` narrows the initial label
 * lookup to a container (e.g. a dialog) when the same label text also exists elsewhere on
 * the page (e.g. a filter select behind a dialog that has a same-named field inside it). */
async function selectMuiOption(page: Page, label: string, optionName: string, scope?: ReturnType<Page["locator"]>) {
  // getByRole("combobox", ...) rather than getByLabel: MUI's open popup <ul role="listbox">
  // carries the same aria-labelledby as its trigger, so a role-agnostic getByLabel lookup
  // can strict-mode-collide with a still-open (or still-exit-transitioning) listbox from a
  // prior selection on this same field — restricting to role=combobox excludes it, since
  // the listbox's own role is "listbox", not "combobox".
  await (scope ? scope : page).getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: optionName }).click();
}

// E2E coverage for the ADMIN-only Users (ניהול משתמשים) and Roles / Role-Permissions
// (ניהול הרשאות) screens — real browser + real backend + real DB (see CLAUDE.md /
// playwright.config.ts header for prerequisites: both `npm run dev` and `uvicorn` must
// already be running against a seeded RiskDB).
//
// Data-safety: every row this spec creates is tagged with uniqueMarker() so a concurrent
// E2E run against the same live DB can't collide with it, and no assertion depends on
// exact global row counts — only on the existence/state of rows this spec itself created.
// The one seeded user this spec touches for read-only purposes is never edited/disabled.

test.describe("Users (ADMIN-only)", () => {
  test("non-ADMIN sees access-denied instead of the user list", async ({ page }) => {
    await login(page, ROLE_CREDENTIALS.RISK_MANAGER);
    await page.goto("/users");
    await expect(page.getByText("מסך זה זמין למנהלי מערכת (ADMIN) בלבד.")).toBeVisible();
    // The table itself must not render for a blocked role.
    await expect(page.getByRole("table")).not.toBeVisible();
  });

  test("ADMIN can create a user, see it in the list with the right role chip, edit its role, and the change persists on reload", async ({
    page,
  }) => {
    const marker = uniqueMarker("e2e-user");
    const email = `${marker}@example.test`;
    const fullName = `E2E Test User ${marker}`;

    await login(page, ROLE_CREDENTIALS.ADMIN);
    await page.goto("/users");
    await expect(page.getByRole("heading", { name: "ניהול משתמשים" })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();

    // --- Create ---
    await page.getByRole("button", { name: "משתמש חדש" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("שם מלא").fill(fullName);
    await page.getByLabel("אימייל").fill(email);
    // Role select defaults to FIELD_WORKER (emptyForm) — explicitly pick PROPERTY_MANAGER
    // so this test actually exercises the role dropdown, not just the default.
    await selectMuiOption(page, "תפקיד", "מנהל נכסים");
    await page.getByRole("button", { name: "יצירה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });

    const row = page.locator("tbody tr", { hasText: email });
    await expect(row).toBeVisible();
    await expect(row.getByText("מנהל נכסים")).toBeVisible();
    await expect(row.getByText("פעיל")).toBeVisible();

    // --- Edit role ---
    await row.getByRole("button", { name: "עריכה" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await selectMuiOption(page, "תפקיד", "עובד שטח");
    await page.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });

    const updatedRow = page.locator("tbody tr", { hasText: email });
    await expect(updatedRow.getByText("עובד שטח")).toBeVisible();

    // --- Verify it persists across a reload (real backend round-trip, not just client state) ---
    await page.reload();
    await expect(page.getByRole("table")).toBeVisible();
    const reloadedRow = page.locator("tbody tr", { hasText: email });
    await expect(reloadedRow.getByText("עובד שטח")).toBeVisible();
    await expect(reloadedRow.getByText("מנהל נכסים")).not.toBeVisible();
  });
});

test.describe("Roles / Role-Permissions (ADMIN-only)", () => {
  test("non-ADMIN sees access-denied instead of the permissions catalog", async ({ page }) => {
    await login(page, ROLE_CREDENTIALS.CFO);
    await page.goto("/roles");
    await expect(page.getByText("מסך זה זמין למנהלי מערכת (ADMIN) בלבד.")).toBeVisible();
    await expect(page.getByRole("table")).not.toBeVisible();
  });

  test("ADMIN can create a role-permission, filter by role, and delete it via the confirm dialog", async ({
    page,
  }) => {
    const permissionKey = uniqueMarker("E2E_PERM").toUpperCase().replace(/-/g, "_");

    await login(page, ROLE_CREDENTIALS.ADMIN);
    await page.goto("/roles");
    await expect(page.getByRole("heading", { name: "ניהול הרשאות (Role Permissions)" })).toBeVisible();

    // --- Create, tagged to RISK_OFFICER so the later role-filter check is unambiguous ---
    await page.getByRole("button", { name: "הרשאה חדשה" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Scoped to the dialog: the page behind it has its own "סינון לפי תפקיד" select whose
    // label also substring-matches a bare "תפקיד" lookup.
    await selectMuiOption(page, "תפקיד", "קצין סיכונים", dialog);
    await page.getByLabel("מפתח הרשאה (permission_key)").fill(permissionKey);
    await page.getByLabel("תיאור").fill(`E2E test permission ${permissionKey}`);
    await page.getByRole("button", { name: "יצירה" }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    const row = page.locator("tbody tr", { hasText: permissionKey });
    await expect(row).toBeVisible();
    await expect(row.getByText("קצין סיכונים")).toBeVisible();

    // --- Filter by role: should still show it under "קצין סיכונים" ---
    await selectMuiOption(page, "סינון לפי תפקיד", "קצין סיכונים");
    await expect(page.locator("tbody tr", { hasText: permissionKey })).toBeVisible();

    // --- Filter by an unrelated role: should disappear ---
    await selectMuiOption(page, "סינון לפי תפקיד", "עובד שטח");
    await expect(page.locator("tbody tr", { hasText: permissionKey })).toHaveCount(0);

    // --- Back to "all roles" to reach the delete action ---
    await selectMuiOption(page, "סינון לפי תפקיד", "כל התפקידים");
    const allRolesRow = page.locator("tbody tr", { hasText: permissionKey });
    await expect(allRolesRow).toBeVisible();

    // --- Delete via the confirm() dialog flow ---
    page.once("dialog", (dialog) => dialog.accept());
    await allRolesRow.getByRole("button", { name: "מחיקה" }).click();
    await expect(page.locator("tbody tr", { hasText: permissionKey })).toHaveCount(0, { timeout: 10_000 });
  });
});
