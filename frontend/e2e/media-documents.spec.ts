import { expect, test } from "@playwright/test";
import type { APIResponse } from "@playwright/test";

import { ROLE_CREDENTIALS, login, logout, uniqueMarker } from "./helpers";

// E2E coverage for property-document and incident-media upload/delete, going beyond the
// happy path: multiple document types on one property, delete-one-keep-one, and the
// RISK_MANAGER/ADMIN-only delete role check on incident media (backend/app/routers/media.py's
// inline require_roles("RISK_MANAGER", "ADMIN") on DELETE /api/media/{id}).
//
// Each test creates its own fresh row (a brand-new property, or a brand-new incident) tagged
// with uniqueMarker() rather than reusing seeded data, so concurrent E2E runs against the same
// live DB (see this task's ground rules) can never make an assertion here flaky.
//
// Requires a real backend + seeded LocalDB running alongside the frontend dev server (see
// playwright.config.ts's header comment).

const TINY_PDF = Buffer.from("%PDF-1.4\n%E2E test fixture\n%%EOF\n");
// Smallest possible well-formed JPEG (a 1x1 white pixel) — real enough for storage.py's
// Pillow-based EXIF read attempt to succeed opening it (even though it carries no EXIF block).
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
  "base64",
);

// Same DOCUMENT_TYPE_LABELS keys/labels as frontend/src/format.ts.
const SURVEY_LABEL = "דוח סקר"; // SURVEY_REPORT
const CORRESPONDENCE_LABEL = "תכתובת"; // CORRESPONDENCE

async function createProperty(page: import("@playwright/test").Page, marker: string): Promise<number> {
  await page.goto("/properties");
  await page.getByRole("button", { name: "נכס חדש" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // Properties.property_code is NVARCHAR(30) (see backend/sql/schema.sql) — the full
  // uniqueMarker() string plus an "E2E-" prefix would overflow that and fail the insert, so
  // derive a short code (base36 timestamp + 3-digit random) instead; the longer marker still
  // goes in the (NVARCHAR(200)) name field for readability/uniqueness in assertions.
  const shortCode = `E2E-${Date.now().toString(36)}${Math.floor(Math.random() * 900 + 100)}`;
  await page.getByLabel("קוד נכס").fill(shortCode);
  await page.getByLabel("שם הנכס").fill(`נכס בדיקה ${marker}`);
  await page.getByLabel("כתובת").fill("רחוב הבדיקה 1, תל אביב");
  await page.getByLabel("קו רוחב (Latitude)").fill("32.0853");
  await page.getByLabel("קו אורך (Longitude)").fill("34.7818");
  await page.getByLabel("שווי כינון (₪)").fill("1000000");
  await page.getByLabel("ערך בספרים (₪)").fill("800000");

  const created = page.waitForResponse(
    (r) => r.url().includes("/api/properties") && r.request().method() === "POST" && r.status() === 201,
  );
  await page.getByRole("button", { name: "יצירה" }).click();
  const resp = await created;
  const body = await resp.json();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });
  return body.property_id as number;
}

async function setDocType(page: import("@playwright/test").Page, label: string) {
  await page.getByLabel("סוג מסמך").click();
  await page.getByRole("option", { name: label }).click();
}

/** A document row's type label renders as a <p> (MUI Typography variant="body2") — scoping to
 * that tag (rather than a bare getByText) avoids also matching the "סוג מסמך" <Select>'s own
 * displayed value, which shows the exact same label text once selected. */
function docTypeLabel(page: import("@playwright/test").Page, label: string) {
  return page.locator("p").filter({ hasText: new RegExp(`^${label}$`) });
}

test.describe("Property documents — deeper coverage", () => {
  test("RISK_MANAGER uploads two document types, then deletes one and keeps the other", async ({ page }) => {
    const marker = uniqueMarker("propdoc");
    await login(page, ROLE_CREDENTIALS.RISK_MANAGER);

    const propertyId = await createProperty(page, marker);
    await page.goto(`/properties/${propertyId}`);
    await expect(page.getByText(`מסמכים מצורפים לנכס (0)`)).toBeVisible({ timeout: 10_000 });

    // --- Upload #1: SURVEY_REPORT ---
    await setDocType(page, SURVEY_LABEL);
    const upload1 = page.waitForResponse(
      (r) => r.url().includes("/api/documents/entity/PROPERTY/") && r.request().method() === "POST" && r.status() === 201,
    );
    await page
      .locator("label", { hasText: "העלאת מסמך" })
      .locator('input[type="file"]')
      .setInputFiles({ name: `survey-${marker}.pdf`, mimeType: "application/pdf", buffer: TINY_PDF });
    await upload1;
    await expect(page.getByText(`מסמכים מצורפים לנכס (1)`)).toBeVisible({ timeout: 10_000 });
    await expect(docTypeLabel(page, SURVEY_LABEL)).toBeVisible();

    // --- Upload #2: CORRESPONDENCE ---
    await setDocType(page, CORRESPONDENCE_LABEL);
    const upload2 = page.waitForResponse(
      (r) => r.url().includes("/api/documents/entity/PROPERTY/") && r.request().method() === "POST" && r.status() === 201,
    );
    await page
      .locator("label", { hasText: "העלאת מסמך" })
      .locator('input[type="file"]')
      .setInputFiles({ name: `correspondence-${marker}.pdf`, mimeType: "application/pdf", buffer: TINY_PDF });
    await upload2;
    await expect(page.getByText(`מסמכים מצורפים לנכס (2)`)).toBeVisible({ timeout: 10_000 });

    // --- Both appear with correct type labels + a working "פתיחה" open link ---
    await expect(docTypeLabel(page, SURVEY_LABEL)).toBeVisible();
    await expect(docTypeLabel(page, CORRESPONDENCE_LABEL)).toBeVisible();
    await expect(page.getByRole("link", { name: "פתיחה" })).toHaveCount(2, { timeout: 10_000 });

    // --- Delete the SURVEY_REPORT row specifically (scoped via its own label's row) ---
    const surveyRow = docTypeLabel(page, SURVEY_LABEL).locator("xpath=ancestor::div[1]");
    await surveyRow.getByRole("button", { name: "מחק מסמך" }).click();

    await expect(page.getByText(`מסמכים מצורפים לנכס (1)`)).toBeVisible({ timeout: 10_000 });
    await expect(docTypeLabel(page, SURVEY_LABEL)).toHaveCount(0);
    await expect(docTypeLabel(page, CORRESPONDENCE_LABEL)).toBeVisible();
    await expect(page.getByRole("link", { name: "פתיחה" })).toHaveCount(1);
  });

  test("PROPERTY_MANAGER can upload a document but has no delete control for it", async ({ page }) => {
    const marker = uniqueMarker("propdoc-pm");
    await login(page, ROLE_CREDENTIALS.PROPERTY_MANAGER);

    const propertyId = await createProperty(page, marker);
    await page.goto(`/properties/${propertyId}`);

    const upload = page.waitForResponse(
      (r) => r.url().includes("/api/documents/entity/PROPERTY/") && r.request().method() === "POST" && r.status() === 201,
    );
    await page
      .locator("label", { hasText: "העלאת מסמך" })
      .locator('input[type="file"]')
      .setInputFiles({ name: `photo-${marker}.pdf`, mimeType: "application/pdf", buffer: TINY_PDF });
    await upload;

    await expect(page.getByText(`מסמכים מצורפים לנכס (1)`)).toBeVisible({ timeout: 10_000 });
    // DOCUMENT_DELETE_ROLES in PropertyDetail.tsx is RISK_MANAGER/ADMIN only (matches
    // backend/app/routers/documents.py's DELETE role check) — PROPERTY_MANAGER can write the
    // property and upload documents to it, but must not see a delete affordance here.
    await expect(page.getByRole("button", { name: "מחק מסמך" })).toHaveCount(0);
  });
});

test.describe("Incident media upload/delete", () => {
  test("a photo attached during incident submission shows as a thumbnail, and only RISK_MANAGER/ADMIN can delete it", async ({
    page,
  }) => {
    const marker = uniqueMarker("incmedia");
    await login(page, ROLE_CREDENTIALS.FIELD_WORKER);

    const propertiesLoaded = page.waitForResponse((r) => r.url().includes("/api/properties") && r.status() === 200);
    await page.goto("/report-incident");
    await expect(page.getByRole("heading", { name: "דיווח על אירוע נזק חדש" })).toBeVisible();
    await propertiesLoaded;

    // Step 0: property + timestamp (timestamp defaults to "now" — see IncidentReport.tsx).
    await page.getByRole("combobox", { name: "נכס" }).click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "המשך" }).click();

    // Step 1: hazard / severity / operational impact.
    await page.getByRole("button", { name: "שריפה" }).click();
    await page.getByRole("button", { name: "גבוהה" }).click();
    await page.getByRole("button", { name: "פעיל כרגיל" }).click();
    await page.getByRole("button", { name: "המשך" }).click();

    // Step 2: description + estimated loss (skip AI classify — extra network dependency).
    await page.getByLabel("תיאור האירוע").fill(`בדיקת מדיה אוטומטית ${marker} — שריפה קטנה במחסן`);
    await page.getByLabel("הערכת נזק ראשונית (₪)").fill("3000");
    await page.getByRole("button", { name: "המשך" }).click();

    // Step 3: attach one fake photo via the regular file-upload input (not the camera-capture
    // one), then submit — IncidentReport.tsx uploads staged media only *after* the incident
    // itself is created successfully (see its submitMutation onSuccess).
    await page
      .locator("label", { hasText: "העלה קובץ" })
      .locator('input[type="file"]')
      .setInputFiles({ name: `field-photo-${marker}.jpg`, mimeType: "image/jpeg", buffer: TINY_JPEG });
    await expect(page.getByText(`field-photo-${marker}.jpg`)).toBeVisible();

    const incidentCreated = page.waitForResponse(
      (r) => r.url().includes("/api/incidents") && r.request().method() === "POST" && r.status() === 201,
    );
    const mediaUploaded = page.waitForResponse(
      (r) => /\/api\/incidents\/\d+\/media$/.test(r.url()) && r.request().method() === "POST" && r.status() === 201,
    );
    await page.getByRole("button", { name: "שלח דיווח למטה" }).click();

    const incidentResp = await incidentCreated;
    const incident = await incidentResp.json();
    const mediaResp = await mediaUploaded;
    const media = await mediaResp.json();

    await expect(page.getByText("הדיווח נשלח בהצלחה")).toBeVisible({ timeout: 15_000 });

    // --- Verify the thumbnail shows up on the incident detail page ---
    await page.goto(`/incidents/${incident.incident_id}`);
    await expect(page.getByText("תמונות ומדיה מהשטח (1)")).toBeVisible({ timeout: 15_000 });

    // --- Role check on DELETE /api/media/{id} (media.py's inline RISK_MANAGER/ADMIN gate) ---
    // IncidentDetail.tsx has no delete UI for incident media at all yet (client.ts's
    // deleteIncidentMedia is defined but unused — flagged separately, out of this spec's file
    // scope to fix), so the role-gate itself is exercised directly against the real backend
    // with each role's own bearer token, exactly as a UI button would if one existed.
    await logout(page);
    await login(page, ROLE_CREDENTIALS.PROPERTY_MANAGER);
    const pmToken = await page.evaluate(() => localStorage.getItem("rmis_access_token"));
    const forbidden: APIResponse = await page.request.delete(`/api/media/${media.media_id}`, {
      headers: { Authorization: `Bearer ${pmToken}` },
    });
    expect(forbidden.status()).toBe(403);

    // The media must still be there after the rejected attempt.
    await page.goto(`/incidents/${incident.incident_id}`);
    await expect(page.getByText("תמונות ומדיה מהשטח (1)")).toBeVisible({ timeout: 15_000 });

    await logout(page);
    await login(page, ROLE_CREDENTIALS.RISK_MANAGER);
    const rmToken = await page.evaluate(() => localStorage.getItem("rmis_access_token"));
    const allowed: APIResponse = await page.request.delete(`/api/media/${media.media_id}`, {
      headers: { Authorization: `Bearer ${rmToken}` },
    });
    expect(allowed.status()).toBe(204);

    await page.goto(`/incidents/${incident.incident_id}`);
    await expect(page.getByText("תמונות ומדיה מהשטח (0)")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("לא צורפה מדיה מהשטח לאירוע זה.")).toBeVisible();
  });
});
