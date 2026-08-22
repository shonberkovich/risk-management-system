import { expect, test } from "@playwright/test";

import { ROLE_CREDENTIALS, login, logout, uniqueMarker } from "./helpers";
import type { RoleName } from "./helpers";

// E2E coverage for Login/Auth + role-based navigation visibility.
//
// Requires a real backend + seeded LocalDB running alongside the frontend dev server (same
// setup field-flow.spec.ts documents — both `npm run dev` on :5173 and `uvicorn` on :8000 with
// a seeded RiskDB must already be up; neither is started here).

// Hebrew role label shown next to the logged-in user's name (Navbar.tsx, ROLE_LABELS in
// frontend/src/format.ts) — duplicated here rather than imported so this spec, like
// helpers.ts's own ROLE_CREDENTIALS, doesn't couple test data to app source module resolution.
const ROLE_LABELS: Record<RoleName, string> = {
  ADMIN: "מנהל מערכת",
  RISK_MANAGER: "מנהל סיכונים",
  RISK_OFFICER: "קצין סיכונים",
  PROPERTY_MANAGER: "מנהל נכסים",
  FIELD_WORKER: "עובד שטח",
  CFO: 'סמנכ"ל כספים',
  ADJUSTER: "שמאי",
};

test.describe("Login", () => {
  test("happy-path login works for multiple roles and shows the right role label", async ({ page }) => {
    for (const role of ["RISK_MANAGER", "ADMIN", "FIELD_WORKER"] as RoleName[]) {
      await login(page, role);
      await expect(page.getByText(ROLE_LABELS[role], { exact: true })).toBeVisible();
      await logout(page);
    }
  });

  test("wrong password shows the error alert and does not log in", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("אימייל").fill(ROLE_CREDENTIALS.RISK_MANAGER.email);
    await page.getByRole("textbox", { name: "סיסמה" }).fill(`Wrong-${uniqueMarker("pw")}`);
    await page.getByRole("button", { name: "התחברות" }).click();

    // Login.tsx surfaces the backend's exact detail message (routers/auth.py: "אימייל או
    // סיסמה שגויים" for any bad credential, deliberately not distinguishing bad email vs. bad
    // password) inside an MUI Alert (role="alert").
    await expect(page.getByRole("alert")).toContainText("אימייל או סיסמה שגויים");

    // Still on the login screen — no session was established.
    await expect(page.getByLabel("אימייל")).toBeVisible();
    await expect(page.getByRole("button", { name: "ניווט" })).toHaveCount(0);
  });

  test("show/hide password toggle actually switches the field's type", async ({ page }) => {
    await page.goto("/");
    // getByRole("textbox", ...) is the documented way to scope to just the password <input>
    // (not the "הצג/הסתר סיסמה" IconButton) — see helpers.ts's header comment.
    const passwordInput = page.getByRole("textbox", { name: "סיסמה" });
    await passwordInput.fill("Demo1234!");
    await expect(passwordInput).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: "הצג סיסמה" }).click();
    await expect(passwordInput).toHaveAttribute("type", "text");
    await expect(passwordInput).toHaveValue("Demo1234!");

    await page.getByRole("button", { name: "הסתר סיסמה" }).click();
    await expect(passwordInput).toHaveAttribute("type", "password");
  });
});

// --- Role-based navigation ---
//
// Source of truth: frontend/src/components/Navbar.tsx's NAV_ENTRIES table. Each leaf link's
// `roles` array is mirrored here (ADMIN always sees everything via canSee()'s fallback); "ALL"
// means no `roles` restriction at all (visible to every authenticated role). Group headers
// render as MUI ListItemButtons (role "button"); leaf links render as <a> (role "link") — a
// group only appears once at least one child is visible to the current role, and even then its
// children stay unmounted (Collapse unmountOnExit) until the group header is clicked.
interface NavItemSpec {
  label: string;
  group: string | null;
  roles: RoleName[] | "ALL";
}

const NAV_ITEMS: NavItemSpec[] = [
  { label: "דשבורד", group: null, roles: "ALL" },

  { label: "נכסים", group: "נכסים ומפה", roles: ["RISK_MANAGER", "PROPERTY_MANAGER", "RISK_OFFICER", "CFO", "ADMIN"] },
  { label: "הפחתת סיכון", group: "נכסים ומפה", roles: ["RISK_MANAGER", "PROPERTY_MANAGER", "ADMIN"] },

  { label: "דיווח אירוע", group: "אירועים ותביעות", roles: "ALL" },
  {
    label: "ניהול אירועים",
    group: "אירועים ותביעות",
    roles: ["RISK_MANAGER", "PROPERTY_MANAGER", "RISK_OFFICER", "FIELD_WORKER", "ADMIN"],
  },
  { label: "תביעות", group: "אירועים ותביעות", roles: ["RISK_MANAGER", "CFO", "ADJUSTER", "ADMIN"] },

  // Wider than the other finance items: policies.py's GET is role-gated to
  // _POLICIES_READ_ROLES (not just the narrower write-role set), so PROPERTY_MANAGER/
  // RISK_OFFICER/ADJUSTER can genuinely read policy data and the nav mirrors that.
  {
    label: "פוליסות",
    group: "ניתוחים פיננסיים",
    roles: ["RISK_MANAGER", "CFO", "PROPERTY_MANAGER", "RISK_OFFICER", "ADJUSTER", "ADMIN"],
  },
  { label: "סימולציה ו-VaR", group: "ניתוחים פיננסיים", roles: ["RISK_MANAGER", "CFO", "ADMIN"] },
  { label: "השתתפות עצמית", group: "ניתוחים פיננסיים", roles: ["RISK_MANAGER", "CFO", "ADMIN"] },
  { label: "דוחות", group: "ניתוחים פיננסיים", roles: ["RISK_MANAGER", "CFO", "ADMIN"] },

  { label: "תאימות ISO 31000", group: "דוחות ציות ו-ISO", roles: ["RISK_MANAGER", "RISK_OFFICER", "CFO", "ADMIN"] },
  { label: "יומן ביקורת", group: "דוחות ציות ו-ISO", roles: ["ADMIN"] },

  { label: "מסמכים", group: "עוד", roles: "ALL" },
  { label: "אינטגרציות", group: "עוד", roles: "ALL" },

  { label: "ניהול משתמשים", group: "ניהול מערכת", roles: ["ADMIN"] },
  { label: "ניהול הרשאות", group: "ניהול מערכת", roles: ["ADMIN"] },
];

const NAV_GROUPS = [...new Set(NAV_ITEMS.map((i) => i.group).filter((g): g is string => g !== null))];

async function openAllVisibleGroups(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "ניווט" }).click();
  for (const group of NAV_GROUPS) {
    const groupButton = page.getByRole("button", { name: group, exact: true });
    // A group with zero visible children is never rendered at all (see NAV_ENTRIES filtering
    // in Navbar.tsx) — only click it open if it actually exists for this role.
    if (await groupButton.count()) {
      await groupButton.click();
    }
  }
}

test.describe("Role-based navigation", () => {
  for (const role of Object.keys(ROLE_CREDENTIALS) as RoleName[]) {
    test(`${role} sees exactly the nav items its role is allowed`, async ({ page }) => {
      await login(page, role);
      await openAllVisibleGroups(page);

      for (const item of NAV_ITEMS) {
        const expectedVisible = item.roles === "ALL" || item.roles.includes(role);
        const locator = page.getByRole("link", { name: item.label, exact: true });
        if (expectedVisible) {
          await expect(locator, `${role} should see "${item.label}"`).toBeVisible();
        } else {
          // toBeHidden() also passes for a locator matching zero elements (a group that isn't
          // rendered at all for this role, or a child never expanded because its group is
          // missing) — exactly right here, since "not shown" and "not in the DOM" are the same
          // observable outcome from the user's perspective.
          await expect(locator, `${role} should NOT see "${item.label}"`).toBeHidden();
        }
      }
    });
  }

  test("spot-check: FIELD_WORKER sees incident reporting but not user/role admin", async ({ page }) => {
    await login(page, "FIELD_WORKER");
    await openAllVisibleGroups(page);
    await expect(page.getByRole("link", { name: "דיווח אירוע", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "ניהול משתמשים", exact: true })).toBeHidden();
    await expect(page.getByRole("link", { name: "ניהול הרשאות", exact: true })).toBeHidden();
    // The admin group itself shouldn't even render for a non-admin role.
    await expect(page.getByRole("button", { name: "ניהול מערכת", exact: true })).toBeHidden();
  });

  test("spot-check: ADMIN sees every nav item", async ({ page }) => {
    await login(page, "ADMIN");
    await openAllVisibleGroups(page);
    for (const item of NAV_ITEMS) {
      await expect(page.getByRole("link", { name: item.label, exact: true }), `ADMIN should see "${item.label}"`).toBeVisible();
    }
  });
});
