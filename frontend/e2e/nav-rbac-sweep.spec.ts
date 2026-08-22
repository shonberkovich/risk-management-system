import { expect, test } from "@playwright/test";

import { ROLE_CREDENTIALS, login, type RoleName } from "./helpers";

// Cross-cutting regression sweep: for all 7 seeded demo roles, the nav drawer
// (Navbar.tsx) must show exactly the top-level links/groups and nested group items that
// role's `roles` config says it should, no more and no less. This mirrors Navbar.tsx's
// NAV_ENTRIES table verbatim (including the /policies fix documented below) rather than
// guessing — see that file for the authoritative source. Every `roles` array below is a
// direct copy of Navbar.tsx's; if that file changes, this table must be updated to match.
//
// Navbar.tsx additionally tags every rendered leaf/group with a `data-testid` (added for
// this spec: `nav-link-<to>` / `nav-group-<key>`) so this sweep doesn't depend on fragile
// text/role queries across 7 roles x ~20 items.

interface Leaf {
  kind: "link";
  to: string;
  roles?: string[];
}
interface Group {
  kind: "group";
  key: string;
  roles?: string[];
  items: Leaf[];
}
type Entry = Leaf | Group;

// Verbatim copy of Navbar.tsx's NAV_ENTRIES (labels/icons omitted — irrelevant to visibility).
const NAV_ENTRIES: Entry[] = [
  { kind: "link", to: "/" },
  {
    kind: "group",
    key: "assets",
    items: [
      { kind: "link", to: "/properties", roles: ["RISK_MANAGER", "PROPERTY_MANAGER", "RISK_OFFICER", "CFO"] },
      { kind: "link", to: "/mitigation", roles: ["RISK_MANAGER", "PROPERTY_MANAGER"] },
    ],
  },
  {
    kind: "group",
    key: "incidents",
    items: [
      { kind: "link", to: "/report-incident" },
      {
        kind: "link",
        to: "/incidents",
        roles: ["RISK_MANAGER", "PROPERTY_MANAGER", "RISK_OFFICER", "FIELD_WORKER"],
      },
      { kind: "link", to: "/claims", roles: ["RISK_MANAGER", "CFO", "ADJUSTER"] },
    ],
  },
  {
    kind: "group",
    key: "finance",
    items: [
      // Fixed during this spec's development (see Navbar.tsx's comment on this leaf): now
      // matches backend/app/routers/policies.py's actual _POLICIES_READ_ROLES GET gate,
      // not just the narrower write-role set.
      {
        kind: "link",
        to: "/policies",
        roles: ["RISK_MANAGER", "CFO", "PROPERTY_MANAGER", "RISK_OFFICER", "ADJUSTER"],
      },
      { kind: "link", to: "/simulation", roles: ["RISK_MANAGER", "CFO"] },
      { kind: "link", to: "/retention", roles: ["RISK_MANAGER", "CFO"] },
      { kind: "link", to: "/reports", roles: ["RISK_MANAGER", "CFO"] },
    ],
  },
  {
    kind: "group",
    key: "compliance",
    items: [
      { kind: "link", to: "/compliance", roles: ["RISK_MANAGER", "RISK_OFFICER", "CFO"] },
      { kind: "link", to: "/audit-log", roles: ["ADMIN"] },
    ],
  },
  {
    kind: "group",
    key: "more",
    items: [
      { kind: "link", to: "/documents" },
      { kind: "link", to: "/integrations" },
    ],
  },
  {
    kind: "group",
    key: "admin",
    roles: ["ADMIN"],
    items: [
      { kind: "link", to: "/users", roles: ["ADMIN"] },
      { kind: "link", to: "/roles", roles: ["ADMIN"] },
    ],
  },
];

// Mirrors Navbar.tsx's own canSee(): undefined roles = everyone; otherwise role must be
// listed, or be ADMIN (ADMIN always sees everything).
function canSee(roles: string[] | undefined, role: string): boolean {
  return !roles || roles.includes(role) || role === "ADMIN";
}

const ALL_ROLES = Object.keys(ROLE_CREDENTIALS) as RoleName[];

for (const role of ALL_ROLES) {
  test(`nav RBAC sweep — ${role} sees exactly its permitted nav items`, async ({ page }) => {
    await login(page, role);

    await page.getByRole("button", { name: "ניווט" }).click();
    const drawer = page.getByTestId("nav-drawer");
    await expect(drawer).toBeVisible();

    for (const entry of NAV_ENTRIES) {
      if (entry.kind === "link") {
        const expected = canSee(entry.roles, role);
        const locator = drawer.getByTestId(`nav-link-${entry.to}`);
        if (expected) {
          await expect(locator, `top-level link ${entry.to} should be visible for ${role}`).toBeVisible();
        } else {
          await expect(locator, `top-level link ${entry.to} should be ABSENT for ${role}`).toHaveCount(0);
        }
        continue;
      }

      // Group: visible only if the group itself passes canSee AND at least one child does
      // (mirrors Navbar.tsx's visibleEntries useMemo filtering logic exactly).
      const visibleChildren = entry.items.filter((item) => canSee(item.roles, role));
      const groupExpectedVisible = canSee(entry.roles, role) && visibleChildren.length > 0;
      const groupLocator = drawer.getByTestId(`nav-group-${entry.key}`);

      if (!groupExpectedVisible) {
        await expect(groupLocator, `group ${entry.key} should be ABSENT for ${role}`).toHaveCount(0);
        continue;
      }

      await expect(groupLocator, `group ${entry.key} should be visible for ${role}`).toBeVisible();
      // Expand the group (Collapse uses unmountOnExit — children aren't even in the DOM
      // until expanded) and verify each child's visibility individually.
      await groupLocator.click();
      for (const item of entry.items) {
        const expected = canSee(item.roles, role);
        const itemLocator = drawer.getByTestId(`nav-link-${item.to}`);
        if (expected) {
          await expect(itemLocator, `${entry.key}/${item.to} should be visible for ${role}`).toBeVisible();
        } else {
          await expect(itemLocator, `${entry.key}/${item.to} should be ABSENT for ${role}`).toHaveCount(0);
        }
      }
    }
  });
}
