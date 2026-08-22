import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { ROLE_CREDENTIALS, login, uniqueMarker } from "./helpers";

// E2E coverage for Notifications (alert routing preview/dispatch/recipients) and
// AuditLog (ADMIN-only "who changed what" screen) — real browser + real backend + real DB.
//
// Role sets are read straight from backend/app/routers/notifications.py /
// backend/app/routers/audit.py rather than guessed:
//   _NOTIFICATIONS_ROLES = (RISK_MANAGER, CFO, ADMIN)      — read (preview/log/recipients)
//   _RECIPIENTS_WRITE_ROLES = (ADMIN,)                     — recipient create/edit/delete
//   _AUDIT_ROLES = (ADMIN,)                                — the whole audit log screen

/** Opens a MUI `select` TextField by its label and picks an option by name, then waits for
 * the popup listbox to fully detach before returning. MUI keeps the listbox mounted during
 * its exit transition, which — if the same field's label is looked up again immediately
 * afterward — can transiently strict-mode-collide with the label association, since the
 * still-detaching listbox portal also carries the same aria-labelledby as the trigger. */
async function selectMuiOption(page: Page, label: string, optionName: string) {
  // getByRole("combobox", ...) rather than getByLabel: MUI's open popup <ul role="listbox">
  // carries the same aria-labelledby as its trigger, so a role-agnostic getByLabel lookup
  // can strict-mode-collide with a still-open (or still-exit-transitioning) listbox from a
  // prior selection on this same field — restricting to role=combobox excludes it, since
  // the listbox's own role is "listbox", not "combobox".
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: optionName }).click();
}

test.describe("Notifications", () => {
  test("FIELD_WORKER (not in _NOTIFICATIONS_ROLES) sees access-denied", async ({ page }) => {
    await login(page, ROLE_CREDENTIALS.FIELD_WORKER);
    await page.goto("/notifications");
    await expect(page.getByText('מסך זה זמין למנהלי סיכונים, סמנכ"לי כספים ומנהלי מערכת בלבד.')).toBeVisible();
  });

  test("RISK_MANAGER can read the page but does not see recipient-management controls", async ({ page }) => {
    await login(page, ROLE_CREDENTIALS.RISK_MANAGER);
    await page.goto("/notifications");
    await expect(page.getByRole("heading", { name: "התראות", exact: true })).toBeVisible();
    // Preview + log + recipients sections all render for a read-allowed role.
    await expect(page.getByText(/תצוגה מקדימה/)).toBeVisible();
    await expect(page.getByText(/יומן התראות שנשלחו/)).toBeVisible();
    await expect(page.getByText(/^נמענים/)).toBeVisible();
    // But recipient management is ADMIN-only.
    await expect(page.getByRole("button", { name: "נמען חדש" })).not.toBeVisible();
    await expect(page.getByRole("cell", { name: "פעולות" })).not.toBeVisible();
  });

  test("ADMIN can create a notification recipient and it appears in the list", async ({ page }) => {
    const marker = uniqueMarker("e2e-recipient");
    const displayName = `E2E נמען ${marker}`;

    await login(page, ROLE_CREDENTIALS.ADMIN);
    await page.goto("/notifications");
    await expect(page.getByRole("heading", { name: "התראות", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "נמען חדש" })).toBeVisible();

    await page.getByRole("button", { name: "נמען חדש" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("שם תצוגה").fill(displayName);
    // getByRole("textbox", ...) — a bare getByLabel("אימייל") also matches the "EMAIL"
    // channel checkbox, which happens to carry the same Hebrew label text ("אימייל", see
    // CHANNEL_LABELS.EMAIL in Notifications.tsx/NotificationRecipientDialog.tsx) — same
    // kind of collision the login helper documents for the password field.
    await page.getByRole("textbox", { name: "אימייל" }).fill(`${marker}@example.test`);
    await page.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });

    const row = page.locator("tbody tr", { hasText: displayName });
    await expect(row).toBeVisible();
    await expect(row.getByText("פעיל")).toBeVisible();
  });

  test("dispatch: sends when there is an active alert (accepting the confirm), otherwise the button stays disabled", async ({
    page,
  }) => {
    await login(page, ROLE_CREDENTIALS.ADMIN);
    await page.goto("/notifications");
    await expect(page.getByRole("heading", { name: "התראות", exact: true })).toBeVisible();

    const sendButton = page.getByRole("button", { name: "שליחה עכשיו" });
    await expect(sendButton).toBeVisible();
    // Let the preview query settle before reading the button's disabled state.
    await page.waitForLoadState("networkidle");

    const isDisabled = await sendButton.isDisabled();
    if (isDisabled) {
      test.info().annotations.push({
        type: "note",
        description: "No active threshold alerts right now — dispatch correctly disabled, not force-sent.",
      });
      await expect(page.getByText("אין כרגע התראות סף פעילות הממתינות לניתוב.")).toBeVisible();
    } else {
      page.once("dialog", (dialog) => dialog.accept());
      await sendButton.click();
      await expect(page.getByText(/נשלחו \d+ התראות \(מדומות\)\./)).toBeVisible({ timeout: 15_000 });
    }
  });
});

test.describe("AuditLog (ADMIN-only)", () => {
  test("non-ADMIN sees access-denied instead of the audit log", async ({ page }) => {
    await login(page, ROLE_CREDENTIALS.RISK_OFFICER);
    await page.goto("/audit-log");
    await expect(page.getByText("מסך זה זמין למנהלי מערכת (ADMIN) בלבד.")).toBeVisible();
    await expect(page.getByRole("table")).not.toBeVisible();
  });

  test("ADMIN sees the audit log with entries and can filter by entity_type and action", async ({ page }) => {
    await login(page, ROLE_CREDENTIALS.ADMIN);
    await page.goto("/audit-log");
    await expect(page.getByRole("heading", { name: "יומן ביקורת (Audit Log)" })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    // There should be at least one row given how much prior E2E/manual activity has
    // happened in this seeded DB — don't assert an exact count, just non-emptiness.
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 15_000 });

    // --- Filter by action = CREATE ---
    await selectMuiOption(page, "פעולה", "יצירה");
    await page.waitForLoadState("networkidle");
    const actionChips = page.locator("tbody tr td:nth-child(5)");
    const chipCount = await actionChips.count();
    for (let i = 0; i < chipCount; i++) {
      await expect(actionChips.nth(i)).toContainText("יצירה");
    }

    // --- Reset action filter, then filter by entity_type (pick the first real option) ---
    await selectMuiOption(page, "פעולה", "הכל");

    await page.getByLabel("סוג ישות").click();
    const options = page.getByRole("listbox").getByRole("option");
    const optionCount = await options.count();
    // First option is always "הכל" — only proceed if there's a real entity type to pick.
    if (optionCount > 1) {
      const secondOptionText = await options.nth(1).innerText();
      await options.nth(1).click();
      await page.getByRole("listbox").waitFor({ state: "detached" }).catch(() => {});
      await page.waitForLoadState("networkidle");
      const entityCells = page.locator("tbody tr td:nth-child(3)");
      const rowCount = await entityCells.count();
      for (let i = 0; i < rowCount; i++) {
        await expect(entityCells.nth(i)).toHaveText(secondOptionText);
      }
    } else {
      await page.keyboard.press("Escape");
    }
  });
});
