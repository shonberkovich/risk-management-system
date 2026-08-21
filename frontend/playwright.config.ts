import { defineConfig, devices } from "@playwright/test";

// E2E coverage for the field flow: Offline -> Sync -> Incident -> Claim (TODO_SPEC.md §9.3).
// Drives the real Vite dev server (proxying /api -> :8000, same as `npm run dev`) against a
// real backend + LocalDB — this is an integration test, not a mocked-fetch unit test, so both
// `npm run dev` (frontend, :5173) and `uvicorn app.main:app` (backend, :8000) with a seeded
// RiskDB must already be running before `npm run test:e2e`. Neither server is started
// automatically here (no `webServer` block) since the backend is a separate process this repo
// doesn't have Playwright manage.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
