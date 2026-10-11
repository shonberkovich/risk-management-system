import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts (rather than a `test` block bolted onto it) so the dev-server
// config (proxy, port) stays free of test-only concerns and vice versa; both share the same
// @vitejs/plugin-react setup so JSX/TSX component tests transform identically to the app build.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // The default 5s is too tight for the userEvent-driven MUI component tests: a dozen of
    // them take 3-4.6s on an idle machine, so any concurrent load (a build, the backend
    // suite, a cold transform cache) pushed some over it — e.g. Emails.ai's summary-banner
    // test at 5256ms — and the suite failed intermittently. 20s matches the per-test
    // override EmailComposeModal.test.tsx already needed for its slowest case.
    testTimeout: 20_000,
    css: false,
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
