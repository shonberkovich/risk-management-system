import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { ROLE_CREDENTIALS, login, logout, uniqueMarker } from "./helpers";

// E2E coverage for Incidents: report wizard (full submit + save-as-draft/resume), the
// incidents list, and the status workflow (NEW -> UNDER_INVESTIGATION -> CLOSED), plus
// regression coverage for the RBAC audit (commit 925936e) that gated IncidentsTable's
// investigate/close/file-claim actions by role. Claims-side flows (filing a claim, editing,
// payments) live in claims.spec.ts.
//
// Requires a real backend + seeded LocalDB running alongside the frontend dev server (see
// playwright.config.ts's header comment and this repo's CLAUDE.md).

const FIELD_WORKER = ROLE_CREDENTIALS.FIELD_WORKER;

// Same RISK_MANAGER/PROPERTY_MANAGER/RISK_OFFICER/ADMIN set backend/app/routers/incidents.py's
// _STATUS_WRITE_ROLES enforces server-side for PATCH .../status.
const STATUS_WRITE_ROLES = ["RISK_MANAGER", "PROPERTY_MANAGER", "RISK_OFFICER", "ADMIN"] as const;

// A property backend/app/seed.py gives >=1 ACTIVE insurance policy covering it (policies 1 and
// 4 both cover property_id 1) — used so any claim-filing flow deterministically reaches a real
// policy list instead of the "no eligible policy" fallback. Reused here (even though this file
// doesn't file claims itself) so incidents created by this spec are consistently claim-eligible
// for anyone cross-checking against claims.spec.ts's own incidents.
const CLAIMABLE_PROPERTY_NAME = 'מרלו"ג מודיעין';

async function gotoReportWizard(page: Page) {
  const propertiesLoaded = page.waitForResponse((r) => r.url().includes("/api/properties") && r.status() === 200);
  await page.goto("/report-incident");
  await expect(page.getByRole("heading", { name: "דיווח על אירוע נזק חדש" })).toBeVisible();
  await propertiesLoaded;
}

/** login() drives to "/" and fills the login form directly — it assumes no session is
 * currently active. Switching actor mid-test (as every multi-role loop below does) must log
 * out first, or "/" renders an authenticated page instead of the login form and login() hangs
 * waiting for a login field that will never appear (same pattern field-flow.spec.ts follows
 * before its own single actor switch). */
async function switchActor(page: Page, role: keyof typeof ROLE_CREDENTIALS) {
  await logout(page);
  await login(page, ROLE_CREDENTIALS[role]);
}

async function pickProperty(page: Page, propertyName: string) {
  const propertyInput = page.getByRole("combobox", { name: "נכס" });
  await propertyInput.click();
  await propertyInput.fill(propertyName);
  await page.getByRole("option", { name: new RegExp(propertyName) }).first().click();
}

/** Fills and submits the full 4-step wizard (skipping AI classify / GPS per instructions) and
 * returns the resulting incident code (e.g. "INC-2026-004"), read off the success screen. */
async function submitIncidentViaWizard(
  page: Page,
  opts: {
    marker: string;
    hazardLabel?: string;
    severityLabel?: string;
    impactLabel?: string;
    propertyName?: string;
  },
): Promise<string> {
  const {
    marker,
    hazardLabel = "שריפה",
    severityLabel = "בינונית",
    impactLabel = "פעיל כרגיל",
    propertyName = CLAIMABLE_PROPERTY_NAME,
  } = opts;

  await gotoReportWizard(page);
  await pickProperty(page, propertyName);
  await page.getByRole("button", { name: "המשך" }).click();

  await page.getByRole("button", { name: hazardLabel }).click();
  await page.getByRole("button", { name: severityLabel }).click();
  await page.getByRole("button", { name: impactLabel }).click();
  await page.getByRole("button", { name: "המשך" }).click();

  await page.getByLabel("תיאור האירוע").fill(`${marker} — תיאור בדיקה אוטומטי`);
  await page.getByLabel("הערכת נזק ראשונית (₪)").fill("10000");
  await page.getByRole("button", { name: "המשך" }).click();

  await page.getByRole("button", { name: "שלח דיווח למטה" }).click();
  await expect(page.getByRole("heading", { name: "הדיווח נשלח בהצלחה" })).toBeVisible({ timeout: 15_000 });

  const codeLine = await page.getByText(/מספר אירוע:/).innerText();
  const code = codeLine.match(/INC-\d{4}-\d+/)?.[0];
  if (!code) throw new Error(`Could not parse incident code from "${codeLine}"`);
  return code;
}

test.describe("Incident report wizard", () => {
  test("field worker submits a full report, it appears in the list, and the detail page shows the empty claim/media state", async ({
    page,
  }) => {
    const marker = uniqueMarker("E2E-incident");
    await login(page, FIELD_WORKER);

    const code = await submitIncidentViaWizard(page, { marker });

    // Reset-the-wizard button on the success screen — a client-side state reset.
    await expect(page.getByRole("button", { name: "דווח אירוע נוסף" })).toBeVisible();

    // GET /api/incidents has no role gate — a FIELD_WORKER can view the list itself.
    await page.goto("/incidents");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });
    const row = page.locator("tbody tr", { hasText: code });
    await expect(row).toBeVisible({ timeout: 15_000 });
    // Only a view button is visible to FIELD_WORKER — regression check alongside the
    // wizard flow (full role-matrix coverage lives in the dedicated RBAC test below).
    await expect(row.getByRole("button", { name: "תיק אירוע מלא" })).toBeVisible();
    await expect(row.getByRole("button", { name: "העבר לבדיקה" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "פתח תביעה" })).toHaveCount(0);

    await row.getByRole("button", { name: "תיק אירוע מלא" }).click();
    await expect(page.getByRole("heading", { name: `תיק אירוע — ${code}` })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(marker)).toBeVisible({ timeout: 15_000 });
    // Empty-state assertions: no media, no documents, no claim yet for this fresh incident.
    await expect(page.getByText("לא צורפה מדיה מהשטח לאירוע זה.")).toBeVisible();
    await expect(
      page.getByText("לא צורפו מסמכים ישירות לאירוע (מסמכי תביעה, כגון דוח שמאי, מופיעים תחת התביעה המשויכת למטה)."),
    ).toBeVisible();
    await expect(page.getByText("טרם הוגשה תביעה עבור אירוע זה.")).toBeVisible();
  });

  test("field worker saves a partial report as a draft, resumes it after reload, then submits it", async ({ page }) => {
    const marker = uniqueMarker("E2E-draft");
    await login(page, FIELD_WORKER);
    await gotoReportWizard(page);

    await pickProperty(page, CLAIMABLE_PROPERTY_NAME);
    await page.getByRole("button", { name: "המשך" }).click();

    await page.getByRole("button", { name: "הצפה" }).click();
    await page.getByRole("button", { name: "נמוכה" }).click();
    await page.getByRole("button", { name: "פעיל כרגיל" }).click();
    await page.getByRole("button", { name: "המשך" }).click();

    // Fill just enough of step 2 (description carries the unique marker so the resumed
    // draft, and the eventually-submitted incident, are both identifiable) then save as a
    // draft instead of continuing to step 3.
    await page.getByLabel("תיאור האירוע").fill(`${marker} — טיוטה חלקית`);
    await page.getByRole("button", { name: "שמור כטיוטה" }).click();
    await expect(page.getByText(/נשמר כטיוטה/)).toBeVisible({ timeout: 15_000 });

    const draftId = await page.evaluate(() => localStorage.getItem("rmis_incident_draft_id"));
    expect(draftId).toBeTruthy();

    // A hard reload re-mounts the component from scratch — the draft-resume effect should
    // pick the same draft id back up from localStorage and repopulate every field.
    await page.reload();
    await expect(page.getByText(/נטענה טיוטה קודמת/)).toBeVisible({ timeout: 15_000 });

    // The wizard remounts at step 0 after reload — the resumed values live in React state
    // (property/hazard/severity/impact/description/etc.), but the description field itself
    // only renders on step 2, so advance there before asserting its value.
    await page.getByRole("button", { name: "המשך" }).click(); // step 0 -> 1 (property/timestamp resumed)
    await page.getByRole("button", { name: "המשך" }).click(); // step 1 -> 2 (hazard/severity/impact resumed)
    await expect(page.getByLabel("תיאור האירוע")).toHaveValue(`${marker} — טיוטה חלקית`);

    // Finish and submit the resumed draft — exercises the draftId-set branch of
    // submitMutation (PATCH + submit) rather than a brand-new create.
    await page.getByLabel("הערכת נזק ראשונית (₪)").fill("7500");
    await page.getByRole("button", { name: "המשך" }).click();
    await page.getByRole("button", { name: "שלח דיווח למטה" }).click();
    await expect(page.getByRole("heading", { name: "הדיווח נשלח בהצלחה" })).toBeVisible({ timeout: 15_000 });
    const codeLine = await page.getByText(/מספר אירוע:/).innerText();
    const code = codeLine.match(/INC-\d{4}-\d+/)?.[0];
    if (!code) throw new Error(`Could not parse incident code from "${codeLine}"`);

    const afterSubmitDraftId = await page.evaluate(() => localStorage.getItem("rmis_incident_draft_id"));
    expect(afterSubmitDraftId).toBeNull();

    // Verify server-side: the resumed-and-submitted draft is now a real, non-draft
    // incident carrying the same description marker.
    await page.goto("/incidents");
    await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });
    const row = page.locator("tbody tr", { hasText: code });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: "תיק אירוע מלא" }).click();
    await expect(page.getByText(marker)).toBeVisible();
  });
});

test.describe("Incidents list — status workflow (regression: RBAC audit commit 925936e)", () => {
  test("each status-write role can move a fresh incident NEW -> UNDER_INVESTIGATION -> CLOSED", async ({ page }) => {
    // 4 roles x (a full wizard submit + a role switch + two status transitions) comfortably
    // exceeds playwright.config.ts's default 60s per-test timeout.
    test.setTimeout(180_000);
    await login(page, FIELD_WORKER);
    for (const role of STATUS_WRITE_ROLES) {
      const marker = uniqueMarker(`E2E-status-${role}`);
      // Loop invariant: logged in as FIELD_WORKER at the top of every iteration.
      const code = await submitIncidentViaWizard(page, { marker });

      await switchActor(page, role);
      await page.goto("/incidents");
      await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });
      const row = page.locator("tbody tr", { hasText: code });
      await expect(row).toBeVisible({ timeout: 15_000 });

      await expect(row.getByText("חדש")).toBeVisible();
      await row.getByRole("button", { name: "העבר לבדיקה" }).click();
      await expect(row.getByText("בבדיקה")).toBeVisible({ timeout: 10_000 });

      await row.getByRole("button", { name: "סגור אירוע (ללא תביעה)" }).click();
      await expect(row.getByText("סגור")).toBeVisible({ timeout: 10_000 });

      // Closed incidents cannot change status further — both action buttons disappear.
      await expect(row.getByRole("button", { name: "העבר לבדיקה" })).toHaveCount(0);
      await expect(row.getByRole("button", { name: "סגור אירוע (ללא תביעה)" })).toHaveCount(0);

      await switchActor(page, "FIELD_WORKER"); // restore the loop invariant for the next iteration
    }
  });

  test("non-status-write roles see no status-change buttons; file-claim visibility follows the separate claims-write role set", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // Create a fresh NEW-status incident first so the negative assertions below are
    // meaningful (a permitted role logging in right now would see live action buttons on
    // this exact row) rather than trivially true because no eligible row existed.
    await login(page, FIELD_WORKER);
    const marker = uniqueMarker("E2E-nonwrite-check");
    const code = await submitIncidentViaWizard(page, { marker });

    // Neither CFO nor FIELD_WORKER is in incidents.py's _STATUS_WRITE_ROLES, so neither should
    // ever see investigate/close — but CFO *is* in claims.py's _CLAIMS_WRITE_ROLES (a genuinely
    // different role set — see Incidents.tsx's canChangeStatus vs. canFileClaim flags), so it
    // must still see "פתח תביעה" while FIELD_WORKER (in neither set) must not.
    const expectations = [
      { role: "CFO", canFileClaim: true },
      { role: "FIELD_WORKER", canFileClaim: false },
    ] as const;

    for (const { role, canFileClaim } of expectations) {
      await switchActor(page, role);
      await page.goto("/incidents");
      await expect(page.getByRole("table")).toBeVisible({ timeout: 15_000 });
      const row = page.locator("tbody tr", { hasText: code });
      await expect(row).toBeVisible({ timeout: 15_000 });

      await expect(page.getByRole("button", { name: "העבר לבדיקה" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "סגור אירוע (ללא תביעה)" })).toHaveCount(0);
      if (canFileClaim) {
        await expect(row.getByRole("button", { name: "פתח תביעה" })).toBeVisible();
      } else {
        await expect(page.getByRole("button", { name: "פתח תביעה" })).toHaveCount(0);
      }
      // The read-only view action always stays available.
      await expect(row.getByRole("button", { name: "תיק אירוע מלא" })).toBeVisible();
    }
  });
});
