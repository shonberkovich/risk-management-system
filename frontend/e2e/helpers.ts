import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Shared E2E helpers — login/logout + the fixed demo-account credentials from
 * backend/app/seed.py (DEMO_PASSWORD = "Demo1234!" for every seeded user), one
 * per role, so every spec file authenticates the same way against the same
 * real accounts rather than each re-deriving its own list.
 *
 * IMPORTANT selector note: Login.tsx's password field and its "show/hide
 * password" IconButton both have accessible names containing the substring
 * "סיסמה" ("הצג סיסמה"/"הסתר סיסמה" vs. the field's own required-asterisked
 * "סיסמה *" label) — Playwright's getByLabel does substring matching by
 * default, so an unqualified `page.getByLabel("סיסמה")` resolves to *two*
 * elements and throws a strict-mode violation; `{ exact: true }` doesn't
 * help either, since the field's real accessible name has the trailing " *"
 * MUI appends for a required field, not a bare "סיסמה". `login()` below
 * instead scopes to `getByRole("textbox", ...)`, which only ever matches the
 * `<input>` (the toggle button has role "button", not "textbox") — the same
 * locator Playwright's own strict-mode-violation error suggests. Any new
 * spec must do the same if it queries the password field directly instead
 * of going through `login()`.
 */
export const ROLE_CREDENTIALS = {
  RISK_MANAGER: { email: "dana.cohen@company.co.il", password: "Demo1234!" },
  CFO: { email: "avi.levi@company.co.il", password: "Demo1234!" },
  PROPERTY_MANAGER: { email: "michal.azoulay@company.co.il", password: "Demo1234!" },
  FIELD_WORKER: { email: "ronit.shimoni@company.co.il", password: "Demo1234!" },
  ADMIN: { email: "admin@company.co.il", password: "Demo1234!" },
  RISK_OFFICER: { email: "noam.friedman@company.co.il", password: "Demo1234!" },
  ADJUSTER: { email: "sara.cohen@adjusters.co.il", password: "Demo1234!" },
} as const;

export type RoleName = keyof typeof ROLE_CREDENTIALS;

export async function login(page: Page, credsOrRole: { email: string; password: string } | RoleName) {
  const creds = typeof credsOrRole === "string" ? ROLE_CREDENTIALS[credsOrRole] : credsOrRole;
  await page.goto("/");
  await page.getByLabel("אימייל").fill(creds.email);
  await page.getByRole("textbox", { name: "סיסמה" }).fill(creds.password);
  await page.getByRole("button", { name: "התחברות" }).click();
  // Navbar.tsx puts "התנתקות" inside the hamburger drawer / user-avatar dropdown menu, neither
  // open by default — the hamburger ("ניווט") button itself, unconditionally in the AppBar once
  // authenticated, is the reliable "login succeeded" signal instead.
  await expect(page.getByRole("button", { name: "ניווט" })).toBeVisible({ timeout: 15_000 });
}

export async function logout(page: Page) {
  // "התנתקות" lives inside the hamburger drawer (Navbar.tsx) — open it first.
  await page.getByRole("button", { name: "ניווט" }).click();
  await page.getByRole("button", { name: "התנתקות" }).click();
  await expect(page.getByLabel("אימייל")).toBeVisible();
}

/** A description/title-safe unique marker for data this spec creates, so a
 * later "does it exist" check can't accidentally match a leftover row from a
 * previous run (same convention e2e/field-flow.spec.ts already established). */
export function uniqueMarker(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}
