/**
 * Regression test for a real bug found while verifying the offline-sync flow
 * (see TODO_SPEC.md §10): TanStack Query v5's `useMutation` defaults to
 * `networkMode: "online"`, which *pauses* a mutation — never invoking
 * `mutationFn` at all — whenever `onlineManager.isOnline()` is false. That
 * silently short-circuited the manual `isNetworkFailure` try/catch inside
 * `saveDraftMutation`/`submitMutation` in `IncidentReport.tsx`, which is the
 * only thing that routes a failed save/submit into the local offline queue
 * (`enqueueIncidentReport`/`enqueueDraftUpdate`/`enqueueDraftSubmit`): with the
 * default networkMode, going offline meant the queue fallback was *never*
 * reached, because the request that's supposed to fail never gets made.
 *
 * `networkMode: "always"` (now set on both mutations) makes `mutationFn` run
 * unconditionally, so the real fetch attempt happens, fails, and the existing
 * catch logic gets a chance to see it and queue the operation.
 *
 * This test doesn't render the full IncidentReport wizard (heavy: geolocation,
 * media upload, AI classification, multi-step form state) — it isolates the
 * exact mechanism via a minimal `useMutation` in both modes, which is what
 * actually determines whether `mutationFn` runs while offline.
 */
import { onlineManager, QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useMutation networkMode while offline", () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient();
  });

  afterEach(() => {
    onlineManager.setOnline(true); // restore the real default between tests
  });

  it("default networkMode ('online') never calls mutationFn while offline — the bug", async () => {
    onlineManager.setOnline(false);
    const mutationFn = vi.fn(async (): Promise<string> => "ok");

    const { result } = renderHook(() => useMutation({ mutationFn }), { wrapper: wrapper(client) });
    result.current.mutate();

    // Give any pending microtasks a chance to run; the mutation should sit "paused"
    // and mutationFn must not have been invoked.
    await new Promise((r) => setTimeout(r, 20));
    expect(mutationFn).not.toHaveBeenCalled();
    expect(result.current.isPaused).toBe(true);
  });

  it("networkMode: 'always' calls mutationFn even while offline — the fix", async () => {
    onlineManager.setOnline(false);
    const mutationFn = vi.fn(async (): Promise<string> => "ok");

    const { result } = renderHook(
      () => useMutation({ mutationFn, networkMode: "always" }),
      { wrapper: wrapper(client) },
    );
    result.current.mutate();

    await waitFor(() => expect(mutationFn).toHaveBeenCalledTimes(1));
    expect(result.current.isPaused).toBe(false);
  });

  it("networkMode: 'always' still lets a rejected mutationFn's catch logic run while offline", async () => {
    onlineManager.setOnline(false);
    const networkError = Object.assign(new Error("Network Error"), { isAxiosError: true });
    const mutationFn = vi.fn(async (): Promise<string> => {
      throw networkError;
    });

    const { result } = renderHook(
      () => useMutation({ mutationFn, networkMode: "always" }),
      { wrapper: wrapper(client) },
    );
    result.current.mutate();

    // The rejection must actually propagate (not stay paused) so IncidentReport.tsx's
    // own try/catch around updateDraftIncident/createIncident etc. gets to run and
    // fall back to the offline queue.
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });
});
