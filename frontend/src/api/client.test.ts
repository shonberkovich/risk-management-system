/**
 * Tests for client.ts's 401 -> silent refresh -> retry interceptor, driven through a
 * stub axios adapter (no network) so each request's status is scripted per URL.
 */
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AUTH_LOGOUT_EVENT, api, getAccessToken, getRefreshToken, setTokens } from "./client";

type Script = (config: InternalAxiosRequestConfig) => { status: number; data?: unknown };

const originalAdapter = api.defaults.adapter;
let calls: string[] = [];

function useScript(script: Script) {
  api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    calls.push(`${config.method?.toUpperCase()} ${config.url} ${config.headers?.Authorization ?? ""}`.trim());
    const { status, data = {} } = script(config);
    const response: AxiosResponse = { data, status, statusText: "", headers: {}, config };
    if (status >= 400) {
      throw new AxiosError(`status ${status}`, "ERR_BAD_REQUEST", config, null, response);
    }
    return response;
  };
}

describe("api 401 refresh interceptor", () => {
  let logoutEvents = 0;
  const onLogout = () => {
    logoutEvents += 1;
  };

  beforeEach(() => {
    calls = [];
    logoutEvents = 0;
    localStorage.clear();
    setTokens("old-access", "refresh-1");
    window.addEventListener(AUTH_LOGOUT_EVENT, onLogout);
  });

  afterEach(() => {
    api.defaults.adapter = originalAdapter;
    window.removeEventListener(AUTH_LOGOUT_EVENT, onLogout);
  });

  it("refreshes once and retries the original request with the new access token", async () => {
    useScript((config) => {
      if (config.url === "/auth/refresh") return { status: 200, data: { access_token: "new-access" } };
      return config.headers?.Authorization === "Bearer new-access" ? { status: 200, data: { ok: true } } : { status: 401 };
    });

    const res = await api.get("/properties");

    expect(res.data).toEqual({ ok: true });
    expect(getAccessToken()).toBe("new-access");
    expect(logoutEvents).toBe(0);
  });

  it("logs out (instead of hanging) when the refresh endpoint itself returns 401", async () => {
    // e.g. the user was disabled by an admin: their access token and refresh token are
    // both rejected. This used to deadlock — the refresh request's own 401 re-entered
    // the interceptor and awaited the in-flight refresh promise it was part of.
    useScript(() => ({ status: 401 }));

    await expect(api.get("/properties")).rejects.toBeInstanceOf(AxiosError);

    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(logoutEvents).toBeGreaterThanOrEqual(1);
    expect(calls.filter((c) => c.startsWith("POST /auth/refresh"))).toHaveLength(1);
  }, 5_000);

  it("does not try to refresh on a failed login", async () => {
    useScript(() => ({ status: 401 }));

    await expect(api.post("/auth/login", { email: "x", password: "y" })).rejects.toBeInstanceOf(AxiosError);

    expect(calls).toEqual(["POST /auth/login Bearer old-access"]);
  });
});
