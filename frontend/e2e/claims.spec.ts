import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { ROLE_CREDENTIALS, login, logout, uniqueMarker } from "./helpers";

// E2E coverage for Claims: filing a claim off an incident, the claims list (filter + Excel
// export), editing a claim's status/approved amount, and recording a payment — plus regression
// coverage for the RBAC audit (commit 925936e) that gated Claims.tsx's edit action and added a
// write-role gate inside ClaimPaymentsDialog's "add payment" form.
//
// Requires a real backend + seeded LocalDB running alongside the frontend dev server (see
// playwright.config.ts's header comment and this repo's CLAUDE.md).

const FIELD_WORKER = ROLE_CREDENTIALS.FIELD_WORKER;

// Same RISK_MANAGER/CFO/ADJUSTER/ADMIN set backend/app/routers/claims.py's
// _CLAIMS_WRITE_ROLES enforces server-side for POST /claims, PATCH /claims/{id}, and POST
// /claims/{id}/payments.
const CLAIMS_WRITE_ROLES = ["RISK_MANAGER", "CFO", "ADJUSTER", "ADMIN"] as const;
// A property backend/app/seed.py gives >=1 ACTIVE insurance policy covering it (policies 1 and
// 4 both cover property_id 1, "מרלו"ג מודיעין") — deterministically claim-eligible, avoiding
// the "no eligible policy" fallback branch field-flow.spec.ts documents for an arbitrary pick.
const CLAIMABLE_PROPERTY_NAME = 'מרלו"ג מודיעין';

async function submitIncidentViaWizard(page: Page, marker: string): Promise<string> {
  const propertiesLoaded = page.waitForResponse((r) => r.url().includes("/api/properties") && r.status() === 200);
  await page.goto("/report-incident");
  await expect(page.getByRole("heading", { name: "דיווח על אירוע נזק חדש" })).toBeVisible();
  await propertiesLoaded;

  const propertyInput = page.getByRole("combobox", { name: "נכס" });
  await propertyInput.click();
  await propertyInput.fill(CLAIMABLE_PROPERTY_NAME);
  await page.getByRole("option", { name: new RegExp(CLAIMABLE_PROPERTY_NAME) }).first().click();
  await page.getByRole("button", { name: "המשך" }).click();

  await page.getByRole("button", { name: "שריפה" }).click();
  await page.getByRole("button", { name: "בינונית" }).click();
  await page.getByRole("button", { name: "פעיל כרגיל" }).click();
  await page.getByRole("button", { name: "המשך" }).click();

  await page.getByLabel("תיאור האירוע").fill(`${marker} — תיאור בדיקה אוטומטי`);
  await page.getByLabel("הערכת נזק ראשונית (₪)").fill("12000");
  await page.getByRole("button", { name: "המשך" }).click();

  await page.getByRole("button", { name: "שלח דיווח למטה" }).click();
  await expect(page.getByRole("heading", { name: "הדיווח נשלח בהצלחה" })).toBeVisible({ timeout: 15_000 });

  const codeLine = await page.getByText(/מספר אירוע:/).innerText();
  const code = codeLine.match(/INC-\d{4}-\d+/)?.[0];
  if (!code) throw new Error(`Could not parse incident code from "${codeLine}"`);
  return code;
}

/** login() drives to "/" and fills the login form directly — it assumes no session is
 * currently active. Switching actor mid-test (as every multi-role flow below does) must log
 * out first, or "/" renders an authenticated page instead of the login form and login() hangs
 * waiting for a login field that will never appear (same pattern field-flow.spec.ts follows
 * before its own single actor switch). */
async function switchActor(page: Page, role: keyof typeof ROLE_CREDENTIALS) {
  await logout(page);
  await login(page, ROLE_CREDENTIALS[role]);
}

/** ClaimsTable's edit/payments IconButtons are located via their icon testid rather than an
 * accessible name — the edit button is always wrapped in a `<span>` (for MUI Tooltip-on-disabled
 * support), which puts the Tooltip's aria-label on that wrapper span instead of the button
 * itself, so `getByRole("button", { name })` doesn't reliably match it. */
function editButton(row: ReturnType<Page["locator"]>) {
  return row.locator('button:has([data-testid="EditIcon"])');
}
function paymentsButton(row: ReturnType<Page["locator"]>) {
  return row.locator('button:has([data-testid="PaymentsIcon"])');
}

test.describe("Filing, editing, and paying a claim (claims-write roles)", () => {
  test("RISK_MANAGER files a claim from an incident, edits it to APPROVED, and records a payment", async ({ page }) => {
    const marker = uniqueMarker("E2E-claim");
    await login(page, FIELD_WORKER);
    const incidentCode = await submitIncidentViaWizard(page, marker);

    await switchActor(page, "RISK_MANAGER");
    await page.goto("/incidents");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });
    const incidentRow = page.locator("tbody tr", { hasText: incidentCode });
    await expect(incidentRow).toBeVisible({ timeout: 15_000 });
    await incidentRow.getByRole("button", { name: "פתח תביעה" }).click();

    const claimDialog = page.getByRole("dialog");
    await expect(claimDialog).toBeVisible();
    // The property behind this incident has active policies (see CLAIMABLE_PROPERTY_NAME's
    // comment) — the dialog must show a real policy select, not the "no eligible policy" warning.
    await expect(claimDialog.getByText("לא נמצאה פוליסה פעילה המכסה את הנכס הזה.")).toHaveCount(0);
    await claimDialog.getByLabel("פוליסה מכסה").click();
    await page.getByRole("option").first().click();

    const createClaimResponse = page.waitForResponse(
      (r) => r.url().endsWith("/api/claims") && r.request().method() === "POST" && r.status() === 201,
    );
    await claimDialog.getByRole("button", { name: "פתח תביעה" }).click();
    const claimBody = await (await createClaimResponse).json();
    const claimNumber: string = claimBody.claim_number;
    await expect(claimDialog).toBeHidden({ timeout: 15_000 });

    // Filing the claim auto-advances the incident to CLAIM_FILED.
    await expect(incidentRow.getByText("תביעה הוגשה")).toBeVisible({ timeout: 10_000 });

    // --- Claims list: filter by status, then edit the claim ---
    await page.goto("/claims");
    await expect(page.getByRole("heading", { name: "מעקב תביעות וסטטוס גבייה" })).toBeVisible();
    await page.getByLabel("סינון לפי סטטוס").click();
    await page.getByRole("option", { name: "טיוטה" }).click();
    let claimRow = page.locator("tbody tr", { hasText: claimNumber });
    await expect(claimRow).toBeVisible({ timeout: 15_000 });

    await editButton(claimRow).click();
    const updateDialog = page.getByRole("dialog");
    await expect(updateDialog).toBeVisible();
    await updateDialog.getByLabel("סטטוס").click();
    await page.getByRole("option", { name: "אושרה" }).click();
    await updateDialog.getByLabel("סכום מאושר (₪)").fill("8000");
    await updateDialog.getByRole("button", { name: "שמירה" }).click();
    await expect(updateDialog).toBeHidden({ timeout: 15_000 });

    // Reset the status filter to see the now-APPROVED claim.
    await page.getByLabel("סינון לפי סטטוס").click();
    await page.getByRole("option", { name: "אושרה" }).click();
    claimRow = page.locator("tbody tr", { hasText: claimNumber });
    await expect(claimRow).toBeVisible({ timeout: 15_000 });
    await expect(claimRow.getByText("אושרה")).toBeVisible();

    // --- Payments: add a payment on the now-APPROVED claim ---
    await paymentsButton(claimRow).click();
    const paymentsDialog = page.getByRole("dialog");
    await expect(paymentsDialog).toBeVisible();
    await expect(paymentsDialog.getByRole("button", { name: "הוספת תשלום" })).toBeVisible();

    const todayIso = new Date().toISOString().slice(0, 10);
    await paymentsDialog.getByLabel("תאריך תשלום").fill(todayIso);
    await paymentsDialog.getByLabel("סכום (₪)").fill("3000");
    await paymentsDialog.getByLabel("מס' אסמכתא").fill(marker);
    await paymentsDialog.getByRole("button", { name: "הוספת תשלום" }).click();

    // Both the "paid so far" summary stat and the new row in the payments table now read
    // 3,000 — either match confirms the payment was recorded.
    await expect(paymentsDialog.getByText("3,000").first()).toBeVisible({ timeout: 15_000 });
    await expect(paymentsDialog.getByText(marker)).toBeVisible();
    await paymentsDialog.getByRole("button", { name: "סגירה" }).click();
    await expect(paymentsDialog).toBeHidden();

    // --- IncidentDetail: the claim section is now populated (was empty before this test) ---
    await page.goto("/incidents");
    await incidentRow.getByRole("button", { name: "תיק אירוע מלא" }).click();
    await expect(page.getByText(`תביעה משויכת (1)`)).toBeVisible();
    await expect(page.getByText(claimNumber)).toBeVisible();
    await expect(page.getByText("אושרה")).toBeVisible();
    await expect(page.getByText(marker).first()).toBeVisible();
  });

  test("every claims-write role sees the file-claim button on an eligible incident", async ({ page }) => {
    // 4 roles x (a full wizard submit + a role switch) comfortably exceeds
    // playwright.config.ts's default 60s per-test timeout.
    test.setTimeout(180_000);
    await login(page, FIELD_WORKER);
    for (const role of CLAIMS_WRITE_ROLES) {
      const marker = uniqueMarker(`E2E-writegate-${role}`);
      // Loop invariant: logged in as FIELD_WORKER at the top of every iteration.
      const incidentCode = await submitIncidentViaWizard(page, marker);

      await switchActor(page, role);
      await page.goto("/incidents");
      await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });
      const row = page.locator("tbody tr", { hasText: incidentCode });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.getByRole("button", { name: "פתח תביעה" })).toBeVisible();

      await switchActor(page, "FIELD_WORKER"); // restore the loop invariant for the next iteration
    }
  });
});

test.describe("Non-claims-write roles are gated (regression: RBAC audit commit 925936e)", () => {
  test("PROPERTY_MANAGER and RISK_OFFICER cannot file a claim, cannot edit a claim, and see the payments dialog as view-only", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const marker = uniqueMarker("E2E-claims-nonwrite");
    await login(page, FIELD_WORKER);
    const incidentCode = await submitIncidentViaWizard(page, marker);

    for (const role of ["PROPERTY_MANAGER", "RISK_OFFICER"] as const) {
      await switchActor(page, role);

      await page.goto("/incidents");
      await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });
      const incidentRow = page.locator("tbody tr", { hasText: incidentCode });
      await expect(incidentRow).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("button", { name: "פתח תביעה" })).toHaveCount(0);

      await page.goto("/claims");
      await expect(page.getByRole("heading", { name: "מעקב תביעות וסטטוס גבייה" })).toBeVisible();
      // No edit action anywhere in the table for a non-write role, but payments viewing
      // (public GET server-side) stays available.
      await expect(page.locator('button:has([data-testid="EditIcon"])')).toHaveCount(0);
      const anyPaymentsButton = page.locator('button:has([data-testid="PaymentsIcon"])').first();
      if (await anyPaymentsButton.count()) {
        await anyPaymentsButton.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("button", { name: "הוספת תשלום" })).toHaveCount(0);
        await expect(dialog.getByText("אין לך הרשאה לרשום תשלומים לתביעות.")).toBeVisible();
        await dialog.getByRole("button", { name: "סגירה" }).click();
        await expect(dialog).toBeHidden();
      }
    }
  });
});

test.describe("Claims list — Excel export", () => {
  test("export button is clickable and does not error", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    await login(page, ROLE_CREDENTIALS.RISK_MANAGER);
    await page.goto("/claims");
    await expect(page.getByRole("heading", { name: "מעקב תביעות וסטטוס גבייה" })).toBeVisible();

    const exportButton = page.getByRole("button", { name: "ייצוא ל-Excel" });
    await expect(exportButton).toBeVisible();
    // Only assert non-disabled/clickable when there's data to export — mirrors Claims.tsx's
    // own `disabled={!data || data.length === 0}` guard.
    if (!(await exportButton.isDisabled())) {
      await exportButton.click();
    }
    await page.waitForTimeout(500);
    expect(pageErrors).toEqual([]);
  });
});
