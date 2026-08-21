import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom has no IndexedDB implementation of its own — fake-indexeddb/auto installs a
// spec-compliant in-memory shim onto the global object so src/offline/syncQueue.ts's
// indexedDB.open(...) calls work under Vitest exactly like they do in a real browser.

// RTL doesn't auto-cleanup outside of specific test-framework globals (Jest's `afterEach`
// hook is auto-wired by @testing-library/react/jest-dom presets, but Vitest's `globals: true`
// doesn't reproduce that magic) — unmount every rendered tree after each test so component
// state/DOM doesn't leak between tests in the same file.
afterEach(() => {
  cleanup();
});
