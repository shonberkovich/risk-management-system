import { expect, test } from "@playwright/test";

import { login } from "./helpers";

// E2E coverage for /simulation (portfolio + per-property Monte Carlo) and /retention (the
// "לספוג או לתבוע" self-insured-retention calculator). Both backend routers
// (routers/simulation.py, routers/retention.py) are intentionally open to any authenticated
// role — no require_roles at all — so these pages are reachable regardless of role; only the
// nav link itself is role-restricted (Navbar.tsx), which doesn't block direct navigation
// (App.tsx has no per-route role gate).
//
// Iteration counts kept at the slider's minimum (1,000 — routers/simulation.py's
// DEFAULT_ITERATIONS is higher, but the slider's own min bound is what these tests use) so
// the real in-process Monte Carlo stays fast.
test.describe("Simulation", () => {
  test("runs a portfolio simulation, then a property-scoped one, and results update correctly", async ({ page }) => {
    await login(page, "RISK_MANAGER");
    await page.goto("/simulation");
    await expect(page.getByRole("heading", { name: "סימולציית תיק וניתוח VaR" })).toBeVisible();

    // Drag the iterations slider down to its minimum (1,000) — it defaults to 10,000.
    const iterationsSlider = page.getByRole("slider").first();
    await iterationsSlider.focus();
    await iterationsSlider.press("Home");
    await expect(page.getByText("מספר הרצות: 1,000")).toBeVisible();

    // Not asserting the transient "מריץ סימולציה..." loading label here — 1,000 in-process
    // Monte Carlo iterations across ~15 properties routinely resolves in well under a
    // render tick, so the loading state can come and go before this assertion even runs.
    await page.getByRole("button", { name: "הרץ סימולציה" }).click();

    // The 4 portfolio KPI cards.
    await expect(page.getByText("הפסד שנתי צפוי")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("תרחיש גרוע (מקסימלי בסימולציה)")).toBeVisible();
    // .first(): "VaR 95%"/"VaR 99%" also appear as <tspan> reference-line labels inside the
    // recharts SVG below — the KPI card's own label is the first match in DOM order.
    await expect(page.getByText("VaR 95%").first()).toBeVisible();
    await expect(page.getByText("VaR 99%").first()).toBeVisible();

    // Distribution chart (recharts) renders, and the result caption shows the
    // portfolio-only "properties_simulated" suffix (see Simulation.tsx's `"properties_simulated"
    // in result` check).
    await expect(page.locator(".recharts-wrapper")).toBeVisible();
    const resultCaption = page.getByText(/התפלגות תוצאות הסימולציה/);
    await expect(resultCaption).toContainText("1,000 הרצות");
    await expect(resultCaption).toContainText("נכסים");

    // Switch scope to a specific property and rerun.
    await page.getByLabel("היקף").click();
    // First real option after "כל התיק (Portfolio)".
    await page.getByRole("option").nth(1).click();

    await page.getByRole("button", { name: "הרץ סימולציה" }).click();
    await expect(page.getByText("הפסד שנתי צפוי")).toBeVisible({ timeout: 30_000 });

    // Property-scoped result has no properties_simulated field — the " · X נכסים" suffix
    // must disappear from the caption.
    await expect(resultCaption).toContainText("1,000 הרצות");
    await expect(resultCaption).not.toContainText("נכסים");
    await expect(page.locator(".recharts-wrapper")).toBeVisible();
  });
});

test.describe("Retention calculator", () => {
  test("FIELD_WORKER (a role with no dedicated nav access) can still reach and use the public retention endpoint", async ({
    page,
  }) => {
    await login(page, "FIELD_WORKER");
    await page.goto("/retention");
    await expect(page.getByRole("heading", { name: "אופטימיזציית השתתפות עצמית" })).toBeVisible();
    await expect(page.getByText('מחשבון "לספוג או לתבוע"')).toBeVisible();

    await page.getByLabel("נכס מבוטח").click();
    await page.getByRole("option").first().click();

    // Selecting a property pre-fills the estimated-loss field from its risk profile's MFL
    // (RetentionCalculator.tsx's handlePropertyChange) — don't overwrite it, just confirm a
    // recommendation can be computed end-to-end against the real backend.
    const lossField = page.getByLabel("נזק משוער (₪)");
    await expect(lossField).not.toHaveValue("");

    await page.getByRole("button", { name: "חשב המלצה" }).click();

    const recommendationChip = page.locator("text=/^המלצה: /");
    await expect(recommendationChip).toBeVisible({ timeout: 15_000 });
    await expect(recommendationChip).toHaveText(/לספוג את הנזק עצמונית|להגיש תביעה/);

    // Plain getByText for these card titles would also match the intro paragraph above,
    // which name-drops both phrases ("...בין ספיגה עצמית מלאה לבין הגשת תביעה...") — scope
    // to the heading role to get just the two result cards.
    await expect(page.getByRole("heading", { name: "ספיגה עצמית" })).toBeVisible();
    await expect(page.getByText("עלות כוללת").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "הגשת תביעה" })).toBeVisible();
    await expect(page.getByText("השתתפות עצמית", { exact: true })).toBeVisible();
    await expect(page.getByText("סכום בר-החזר מהמבטח")).toBeVisible();
    await expect(page.getByText("תשלום מכיס (השתתפות בפועל)")).toBeVisible();
    // exact:true: the intro paragraph above also name-drops this exact phrase inline.
    await expect(page.getByText("תוספת פרמיה עתידית צפויה", { exact: true })).toBeVisible();
    await expect(page.getByText(/שגיאה בחישוב ההמלצה/)).toBeHidden();
  });
});
