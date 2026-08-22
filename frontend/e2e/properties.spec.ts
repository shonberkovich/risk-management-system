import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { login, logout, uniqueMarker } from "./helpers";

// E2E coverage for the Properties module: the list page + PropertyDetail drill-down.
//
// Requires a real backend + seeded LocalDB running alongside the frontend dev server (same
// setup field-flow.spec.ts documents). Runs against the SAME live DB other agents' suites use
// concurrently, so this file only ever creates its own uniqueMarker()-tagged rows and never
// asserts on exact global counts — see this repo's CLAUDE.md / the task brief for why.
//
// Write-role sets below mirror backend/app/routers/properties.py's _PROPERTIES_WRITE_ROLES
// (property + risk-survey CRUD) and backend/app/routers/documents.py's require_roles on DELETE
// (narrower — RISK_MANAGER/ADMIN only, not PROPERTY_MANAGER). See PropertyDetail.tsx's
// DOCUMENT_DELETE_ROLES comment for the bug this narrower set fixes.
const PROPERTY_WRITE_ROLES = ["RISK_MANAGER", "PROPERTY_MANAGER", "ADMIN"] as const;
const NON_WRITE_ROLES = ["FIELD_WORKER", "CFO"] as const;

test.describe.configure({ mode: "serial" });

// A known seeded property (backend/app/seed.py) — read-only reference, never mutated, just used
// to confirm the list renders real backend data rather than an empty/mocked state.
const SEEDED_PROPERTY_NAME = 'מרלו"ג מודיעין';

async function openCreatedProperty(page: Page, name: string) {
  // The property name Typography sits inside the whole Card's CardActionArea, so a click on the
  // text itself bubbles up and navigates — same pattern as clicking any card in this page.
  await page.getByText(name, { exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible({ timeout: 15_000 });
}

test.describe("Properties list", () => {
  test("loads and shows real seeded properties", async ({ page }) => {
    await login(page, "RISK_MANAGER");
    await page.goto("/properties");
    await expect(page.getByRole("heading", { name: /רשימת נכסים \(\d+\)/ })).toBeVisible();
    await expect(page.getByText(SEEDED_PROPERTY_NAME, { exact: true })).toBeVisible();
  });

  test('"נכס חדש" button is gated to property-write roles', async ({ page }) => {
    for (const role of PROPERTY_WRITE_ROLES) {
      await login(page, role);
      await page.goto("/properties");
      await expect(page.getByRole("button", { name: "נכס חדש" }), `${role} should see "נכס חדש"`).toBeVisible();
      await logout(page);
    }
    for (const role of NON_WRITE_ROLES) {
      await login(page, role);
      await page.goto("/properties");
      await expect(page.getByRole("heading", { name: /רשימת נכסים/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "נכס חדש" }), `${role} should NOT see "נכס חדש"`).toBeHidden();
      await logout(page);
    }
  });
});

test.describe("Property create + detail workflow", () => {
  // Properties.property_code is NVARCHAR(30) (backend/app/models.py) with no client- or
  // server-side length validation in front of it (PropertyCreate/Update accept a bare `str`) —
  // a code longer than that silently 500s instead of a clean validation error. Keep this
  // marker's prefix short so property_code (marker used as-is, no extra prefix) comfortably
  // fits: "PRP-E2E-<13-digit ms epoch>-<up to 4 random digits>" is at most 27 chars.
  const marker = uniqueMarker("PRP-E2E");
  const propertyName = `נכס בדיקה ${marker}`;
  const propertyCode = marker;

  test("RISK_MANAGER creates a new property via the dialog and it appears in the list", async ({ page }) => {
    await login(page, "RISK_MANAGER");
    await page.goto("/properties");
    await page.getByRole("button", { name: "נכס חדש" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("קוד נכס").fill(propertyCode);
    await dialog.getByLabel("שם הנכס").fill(propertyName);
    await dialog.getByLabel("כתובת").fill(`רחוב הבדיקה 1, תל אביב (${marker})`);
    await dialog.getByLabel("קו רוחב (Latitude)").fill("32.05");
    await dialog.getByLabel("קו אורך (Longitude)").fill("34.75");
    await dialog.getByLabel("שווי כינון (₪)").fill("1000000");
    await dialog.getByLabel("ערך בספרים (₪)").fill("800000");
    await dialog.getByRole("button", { name: "יצירה" }).click();

    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(propertyName, { exact: true })).toBeVisible();
    await expect(page.getByText(propertyCode, { exact: true })).toBeVisible();
  });

  test("RISK_MANAGER creates and then updates a risk survey on the new property", async ({ page }) => {
    await login(page, "RISK_MANAGER");
    await page.goto("/properties");
    await openCreatedProperty(page, propertyName);

    // No survey yet — the card shows the empty state and a "סקר חדש" (not "עדכון סקר") button.
    await expect(page.getByText("טרם נערך סקר סיכונים לנכס זה.")).toBeVisible();
    await page.getByRole("button", { name: "סקר חדש" }).click();

    const createDialog = page.getByRole("dialog");
    await expect(createDialog.getByRole("heading", { name: "סקר סיכונים חדש" })).toBeVisible();
    await createDialog.getByLabel(/MFL/).fill("500000");
    await createDialog.getByLabel("קיימים מתזים").click();
    await createDialog.getByLabel(/הערות/).fill(`הערת בדיקה ${marker}`);
    await createDialog.getByRole("button", { name: "שמירה" }).click();
    await expect(createDialog).toBeHidden({ timeout: 15_000 });

    await expect(page.getByText("‏500,000 ‏₪")).toBeVisible();
    await expect(page.getByText("מותקנים מתזים")).toBeVisible();
    // Existing survey now uses the update button/dialog title.
    await expect(page.getByRole("button", { name: "עדכון סקר" })).toBeVisible();

    await page.getByRole("button", { name: "עדכון סקר" }).click();
    const updateDialog = page.getByRole("dialog");
    await expect(updateDialog.getByRole("heading", { name: "עדכון סקר סיכונים" })).toBeVisible();
    await updateDialog.getByLabel(/MFL/).fill("750000");
    await updateDialog.getByRole("button", { name: "שמירה" }).click();
    await expect(updateDialog).toBeHidden({ timeout: 15_000 });

    await expect(page.getByText("‏750,000 ‏₪")).toBeVisible();
  });

  test("RISK_MANAGER uploads and deletes a document on the new property", async ({ page }) => {
    await login(page, "RISK_MANAGER");
    await page.goto("/properties");
    await openCreatedProperty(page, propertyName);

    await expect(page.getByText("לא צורפו מסמכים לנכס זה עדיין.")).toBeVisible();

    const docMarker = uniqueMarker("doc");
    await page.locator('input[type="file"]').setInputFiles({
      name: `survey-${docMarker}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(`E2E test document ${docMarker}`, "utf-8"),
    });

    // DOC_TYPE_OPTIONS defaults to the first key of DOCUMENT_TYPE_LABELS (POLICY_DOCUMENT ->
    // "פוליסת ביטוח") since the upload form's doc-type select isn't touched above.
    const docRow = page.getByText("פוליסת ביטוח").first();
    await expect(docRow).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("מסמכים מצורפים לנכס (1)")).toBeVisible();

    // RISK_MANAGER is in documents.py's DELETE role set (RISK_MANAGER/ADMIN) — the delete icon
    // should be visible and functional.
    await page.getByRole("button", { name: "מחק מסמך" }).click();
    await expect(page.getByText("לא צורפו מסמכים לנכס זה עדיין.")).toBeVisible({ timeout: 15_000 });
  });

  test("PROPERTY_MANAGER can edit the property but cannot delete an attached document", async ({ page }) => {
    // Re-upload a document as RISK_MANAGER first (the previous test deleted the one it made).
    await login(page, "RISK_MANAGER");
    await page.goto("/properties");
    await openCreatedProperty(page, propertyName);
    const docMarker = uniqueMarker("doc2");
    await page.locator('input[type="file"]').setInputFiles({
      name: `report-${docMarker}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(`E2E test document ${docMarker}`, "utf-8"),
    });
    await expect(page.getByText("מסמכים מצורפים לנכס (1)")).toBeVisible({ timeout: 15_000 });
    const detailUrl = page.url();
    await logout(page);

    // PROPERTY_MANAGER is in _PROPERTIES_WRITE_ROLES (can edit/deactivate/survey) but NOT in
    // documents.py's narrower DELETE role set (RISK_MANAGER/ADMIN only) — the delete button
    // must stay hidden for them, otherwise clicking it would 403 (the bug fixed in
    // PropertyDetail.tsx's DOCUMENT_DELETE_ROLES).
    await login(page, "PROPERTY_MANAGER");
    await page.goto(detailUrl);
    await expect(page.getByRole("heading", { name: propertyName, exact: true })).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole("button", { name: "עריכה" })).toBeVisible();
    await expect(page.getByRole("button", { name: "השבתת נכס" })).toBeVisible();
    await expect(page.getByRole("button", { name: /עדכון סקר|סקר חדש/ })).toBeVisible();
    await expect(page.getByText("מסמכים מצורפים לנכס (1)")).toBeVisible();
    await expect(page.getByRole("button", { name: "מחק מסמך" })).toBeHidden();

    // Clean up the document as RISK_MANAGER so this spec doesn't leave orphaned storage files
    // behind across repeated runs.
    await logout(page);
    await login(page, "RISK_MANAGER");
    await page.goto(detailUrl);
    await page.getByRole("button", { name: "מחק מסמך" }).click();
    await expect(page.getByText("לא צורפו מסמכים לנכס זה עדיין.")).toBeVisible({ timeout: 15_000 });
  });

  test("FIELD_WORKER sees the property read-only: no edit/deactivate/survey/upload controls", async ({ page }) => {
    await login(page, "RISK_MANAGER");
    await page.goto("/properties");
    await openCreatedProperty(page, propertyName);
    const detailUrl = page.url();
    await logout(page);

    await login(page, "FIELD_WORKER");
    await page.goto(detailUrl);
    await expect(page.getByRole("heading", { name: propertyName, exact: true })).toBeVisible({ timeout: 15_000 });

    // Read-only content still renders.
    await expect(page.getByRole("heading", { name: "פוליסה פעילה" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "סקר סיכונים" })).toBeVisible();
    await expect(page.getByText(/מסמכים מצורפים לנכס/)).toBeVisible();

    // Write controls are all gated off.
    await expect(page.getByRole("button", { name: "עריכה" })).toBeHidden();
    await expect(page.getByRole("button", { name: "השבתת נכס" })).toBeHidden();
    await expect(page.getByRole("button", { name: /עדכון סקר|סקר חדש/ })).toBeHidden();
    await expect(page.getByRole("button", { name: "העלאת מסמך" })).toBeHidden();
  });
});

test.describe("Nonexistent property", () => {
  test("navigating to a nonexistent property id shows a clean not-found state", async ({ page }) => {
    await login(page, "RISK_MANAGER");
    await page.goto("/properties/999999");
    await expect(page.getByText("הנכס המבוקש לא נמצא.")).toBeVisible({ timeout: 15_000 });
    // No crash / blank page: the rest of the shell (nav) still renders around the error.
    await expect(page.getByRole("button", { name: "ניווט" })).toBeVisible();
  });
});
