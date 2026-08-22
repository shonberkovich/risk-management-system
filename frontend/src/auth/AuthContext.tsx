import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  AUTH_LOGOUT_EVENT,
  clearTokens,
  fetchCurrentUser,
  getAccessToken,
  login as loginRequest,
  logout as logoutRequest,
  setTokens,
  updateMySignature,
} from "../api/client";
import type { CurrentUser } from "../api/client";

interface AuthContextValue {
  user: CurrentUser | null;
  /** True only while the initial session (token → /auth/me) is being resolved on load. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** TODO_SPEC.md "משימה 14" step 2/3 — saves via `PATCH /api/users/{id}/signature`
   * and updates the in-memory `user` so ProfileSettings and a currently-open Compose
   * modal both see the new signature immediately, without a page reload or an extra
   * /auth/me round-trip. */
  updateSignature: (signature: string | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const doLogout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  useEffect(() => {
    // A stored access token from a previous visit — confirm it's still valid via /me
    // rather than trusting it blindly (it may have expired since the last session).
    if (!getAccessToken()) {
      setLoading(false);
      return;
    }
    fetchCurrentUser()
      .then(setUser)
      .catch(() => clearTokens())
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Raised by the axios response interceptor (client.ts) when a refresh attempt fails.
    window.addEventListener(AUTH_LOGOUT_EVENT, doLogout);
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, doLogout);
  }, [doLogout]);

  const login = useCallback(async (email: string, password: string) => {
    const tokens = await loginRequest({ email, password });
    setTokens(tokens.access_token, tokens.refresh_token);
    setUser(tokens.user);
  }, []);

  const logout = useCallback(() => {
    // Best-effort call (stateless JWTs — server has nothing to revoke, see routers/auth.py);
    // local state is cleared regardless of whether it succeeds.
    logoutRequest().catch(() => undefined);
    doLogout();
  }, [doLogout]);

  const updateSignature = useCallback(
    async (signature: string | null) => {
      if (!user) throw new Error("updateSignature called with no signed-in user");
      const updated = await updateMySignature(user.user_id, signature);
      setUser(updated);
    },
    [user],
  );

  const value = useMemo(
    () => ({ user, loading, login, logout, updateSignature }),
    [user, loading, login, logout, updateSignature],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
