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
    css: false,
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
