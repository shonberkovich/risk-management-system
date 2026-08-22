/**
 * Tests for useSSE (TODO_SPEC.md "משימה 9"): connects only when there's an authenticated
 * user + stored access token, reacts to a `new_email` SSE event (query invalidation +
 * caller callback), and disconnects cleanly on unmount / when the user goes away (logout).
 *
 * jsdom has no native `EventSource` — this file supplies a minimal stand-in (tracking
 * open instances, registered listeners, and whether `.close()` was called) rather than
 * pulling in a polyfill dependency just for one hook's tests.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useAuthMock, getAccessTokenMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getAccessTokenMock: vi.fn(),
}));

vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));
vi.mock("../api/client", () => ({ getAccessToken: getAccessTokenMock }));

import { useSSE, type NewEmailPayload } from "./useSSE";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  private listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  /** Test helper: simulate the server pushing `event: <type>\ndata: <json>\n\n`. */
  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent<string>;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const AUTH_USER = { user_id: 1, full_name: "דנה כהן", role: "RISK_MANAGER" };

describe("useSSE", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not open a connection when there is no authenticated user", () => {
    useAuthMock.mockReturnValue({ user: null });
    getAccessTokenMock.mockReturnValue("some-token");
    const queryClient = new QueryClient();

    renderHook(() => useSSE(), { wrapper: wrapper(queryClient) });

    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("does not open a connection when there is no stored access token", () => {
    useAuthMock.mockReturnValue({ user: AUTH_USER });
    getAccessTokenMock.mockReturnValue(null);
    const queryClient = new QueryClient();

    renderHook(() => useSSE(), { wrapper: wrapper(queryClient) });

    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("opens exactly one EventSource against /api/sse/stream with the token as a query param when authenticated", () => {
    useAuthMock.mockReturnValue({ user: AUTH_USER });
    getAccessTokenMock.mockReturnValue("abc123");
    const queryClient = new QueryClient();

    renderHook(() => useSSE(), { wrapper: wrapper(queryClient) });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/api/sse/stream?token=abc123");
  });

  it("invalidates every [\"emails\", ...] query and calls the onNewEmail callback on a new_email event", () => {
    useAuthMock.mockReturnValue({ user: AUTH_USER });
    getAccessTokenMock.mockReturnValue("abc123");
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const onNewEmail = vi.fn();

    renderHook(() => useSSE(onNewEmail), { wrapper: wrapper(queryClient) });

    const payload: NewEmailPayload = {
      type: "new_email",
      email_id: 42,
      thread_id: 42,
      subject: "עדכון דחוף",
      sender_id: 2,
      created_at: "2026-08-22T10:00:00Z",
    };
    MockEventSource.instances[0].emit("new_email", payload);

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["emails"] });
    expect(onNewEmail).toHaveBeenCalledWith(payload);
  });

  it("always invalidates on new_email even without an onNewEmail callback given", () => {
    useAuthMock.mockReturnValue({ user: AUTH_USER });
    getAccessTokenMock.mockReturnValue("abc123");
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useSSE(), { wrapper: wrapper(queryClient) });
    MockEventSource.instances[0].emit("new_email", {
      type: "new_email",
      email_id: 1,
      thread_id: 1,
      subject: "s",
      sender_id: 1,
      created_at: "2026-08-22T10:00:00Z",
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["emails"] });
  });

  it("closes the EventSource on unmount", () => {
    useAuthMock.mockReturnValue({ user: AUTH_USER });
    getAccessTokenMock.mockReturnValue("abc123");
    const queryClient = new QueryClient();

    const { unmount } = renderHook(() => useSSE(), { wrapper: wrapper(queryClient) });
    const instance = MockEventSource.instances[0];
    expect(instance.closed).toBe(false);

    unmount();

    expect(instance.closed).toBe(true);
  });

  it("closes the EventSource and does not reopen one when the user becomes null (logout)", () => {
    useAuthMock.mockReturnValue({ user: AUTH_USER });
    getAccessTokenMock.mockReturnValue("abc123");
    const queryClient = new QueryClient();

    const { rerender } = renderHook(() => useSSE(), { wrapper: wrapper(queryClient) });
    expect(MockEventSource.instances).toHaveLength(1);
    const instance = MockEventSource.instances[0];

    useAuthMock.mockReturnValue({ user: null });
    rerender();

    expect(instance.closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(1); // no second connection opened
  });

  it("passing a fresh inline callback on every render does not tear down and reopen the connection", () => {
    useAuthMock.mockReturnValue({ user: AUTH_USER });
    getAccessTokenMock.mockReturnValue("abc123");
    const queryClient = new QueryClient();

    const { rerender } = renderHook(({ cb }: { cb: (p: NewEmailPayload) => void }) => useSSE(cb), {
      wrapper: wrapper(queryClient),
      initialProps: { cb: () => {} },
    });
    expect(MockEventSource.instances).toHaveLength(1);
    const instance = MockEventSource.instances[0];

    rerender({ cb: () => {} }); // a brand-new function identity, same as an inline arrow would be

    expect(instance.closed).toBe(false);
    expect(MockEventSource.instances).toHaveLength(1);
  });
});
