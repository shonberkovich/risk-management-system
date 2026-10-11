import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { getAccessToken } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/** Mirrors the `new_email` event payload broadcast by `backend/app/services/email.py`
 * (see its `send_email` — the shape is deliberately minimal, just enough to invalidate
 * a query and render a toast, not the full email body). */
export interface NewEmailPayload {
  type: "new_email";
  email_id: number;
  thread_id: number;
  subject: string;
  sender_id: number;
  created_at: string;
}

/** TODO_SPEC.md "משימה 9" — opens the app-wide SSE connection (`backend/app/routers/
 * sse.py`'s `GET /api/sse/stream?token=...`, see that module's docstring for why auth
 * travels as a query param instead of the usual `Authorization` header: `EventSource`
 * can't set custom request headers) and reacts to `new_email` events.
 *
 * Two things happen on every `new_email` event, unconditionally:
 *  - Every `["emails", ...]` query is invalidated (covers both Emails.tsx's folder-scoped
 *    list, `["emails", folder]`, and EmailSidebar's per-folder unread badge, `["emails",
 *    folder, "unread-count"]` — same broad-invalidation shape Emails.tsx's own
 *    `markReadMutation` already uses). This is the primary refresh path; both call sites'
 *    `refetchInterval` polling stays in place only as a slower fallback for the rare case
 *    the SSE connection itself is down.
 *  - `onNewEmail`, if given, is called with the raw payload — e.g. Layout.tsx uses this to
 *    pop a global toast. Kept as a plain callback prop (matching how e.g. EmailSidebar's
 *    `onSelect` is wired) rather than a window CustomEvent: unlike `AUTH_LOGOUT_EVENT` in
 *    api/client.ts (which exists because the axios interceptor that raises it has no
 *    access to React state/context at all), this hook already runs inside a component
 *    tree with a single caller (Layout, mounted once), so a plain callback is simpler and
 *    type-safe with no DOM-global indirection needed. The callback is read through a ref
 *    so passing a fresh inline arrow on every render never tears down/reopens the
 *    connection — only an actual auth change does.
 *
 * Connects only while there's a signed-in user with a stored access token; closes
 * (effect cleanup) the moment either goes away — covers both logout (user -> null, e.g.
 * via AUTH_LOGOUT_EVENT bubbling into AuthContext) and this component unmounting.
 * Reconnection on a dropped connection is left to the browser's native `EventSource`
 * behavior (auto-retries the same URL after a short delay unless `.close()` was called),
 * with one exception: the browser gives up for good (readyState CLOSED) when a retry gets
 * a non-200 — typically a 401 once the access token baked into the URL has expired (30
 * min), e.g. after the server restarted under a long-open tab. Live updates would then
 * stop in that tab until a full reload, so in that case only the hook opens a new
 * connection itself, with whatever token is current by then (the axios interceptor keeps
 * it refreshed — Navbar polls every 60s), backing off from RECONNECT_BASE_DELAY_MS up to
 * RECONNECT_MAX_DELAY_MS while attempts keep failing.
 */
export const RECONNECT_BASE_DELAY_MS = 5_000;
export const RECONNECT_MAX_DELAY_MS = 60_000;

export function useSSE(onNewEmail?: (payload: NewEmailPayload) => void): void {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const onNewEmailRef = useRef(onNewEmail);
  useEffect(() => {
    onNewEmailRef.current = onNewEmail;
  }, [onNewEmail]);

  useEffect(() => {
    if (!user || !getAccessToken()) {
      return;
    }

    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let failedReconnects = 0;

    const handleNewEmail = (event: MessageEvent<string>) => {
      let payload: NewEmailPayload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        // Malformed payload — ignore rather than crash the whole SSE connection over it.
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["emails"] });
      onNewEmailRef.current?.(payload);
    };

    const connect = () => {
      const token = getAccessToken();
      if (!token) {
        return; // signed out since — AuthContext tears this effect down anyway
      }
      const current = new EventSource(`/api/sse/stream?token=${encodeURIComponent(token)}`);
      current.addEventListener("new_email", handleNewEmail);
      current.addEventListener("open", () => {
        failedReconnects = 0;
      });
      current.addEventListener("error", () => {
        // Still CONNECTING: a plain drop the browser is already retrying on its own.
        if (current.readyState !== EventSource.CLOSED) {
          return;
        }
        current.removeEventListener("new_email", handleNewEmail);
        const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** failedReconnects, RECONNECT_MAX_DELAY_MS);
        failedReconnects += 1;
        reconnectTimer = setTimeout(connect, delay);
      });
      source = current;
    };
    connect();

    return () => {
      clearTimeout(reconnectTimer);
      source?.removeEventListener("new_email", handleNewEmail);
      source?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onNewEmail intentionally excluded, see onNewEmailRef above.
  }, [user, queryClient]);
}
