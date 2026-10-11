/**
 * AuthContext — the React Query cache is per session: signing out (by hand or because
 * the refresh token failed) and signing in both drop it, so the next user on the same
 * tab never sees the previous user's cached data.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loginRequest: vi.fn(),
  logoutRequest: vi.fn(),
  fetchCurrentUser: vi.fn(),
  getAccessToken: vi.fn(),
}));

vi.mock("../api/client", () => ({
  AUTH_LOGOUT_EVENT: "rmis:auth:logout",
  clearTokens: vi.fn(),
  setTokens: vi.fn(),
  fetchCurrentUser: mocks.fetchCurrentUser,
  getAccessToken: mocks.getAccessToken,
  login: mocks.loginRequest,
  logout: mocks.logoutRequest,
  updateMyAutoResponder: vi.fn(),
  updateMySignature: vi.fn(),
}));

import { AuthProvider, useAuth } from "./AuthContext";

const CFO = { user_id: 2, full_name: "אבי", email: "avi@x.co.il", role: "CFO" };
const FIELD_WORKER = { user_id: 5, full_name: "רונית", email: "ronit@x.co.il", role: "FIELD_WORKER" };

let auth: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  return <span data-testid="who">{auth.user?.full_name ?? "none"}</span>;
}

function renderWithCache(queryClient: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
  return render(<Probe />, { wrapper });
}

describe("AuthContext — query cache per session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAccessToken.mockReturnValue("token");
    mocks.fetchCurrentUser.mockResolvedValue(CFO);
    mocks.logoutRequest.mockResolvedValue(undefined);
  });

  it("logout drops every cached query", async () => {
    const queryClient = new QueryClient();
    renderWithCache(queryClient);
    await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("אבי"));
    queryClient.setQueryData(["policies", ""], [{ policy_id: 1, policy_number: "POL-1" }]);

    act(() => auth.logout());

    expect(screen.getByTestId("who")).toHaveTextContent("none");
    expect(queryClient.getQueryData(["policies", ""])).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("a forced logout (failed token refresh) drops the cache too", async () => {
    const queryClient = new QueryClient();
    renderWithCache(queryClient);
    await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("אבי"));
    queryClient.setQueryData(["claims", ""], [{ claim_id: 1 }]);

    act(() => {
      window.dispatchEvent(new Event("rmis:auth:logout"));
    });

    expect(queryClient.getQueryData(["claims", ""])).toBeUndefined();
  });

  it("signing in starts from an empty cache", async () => {
    mocks.getAccessToken.mockReturnValue(null);
    const queryClient = new QueryClient();
    renderWithCache(queryClient);
    queryClient.setQueryData(["policies", ""], [{ policy_id: 1 }]);
    mocks.loginRequest.mockResolvedValue({ access_token: "a", refresh_token: "r", user: FIELD_WORKER });

    await act(() => auth.login("ronit@x.co.il", "Demo1234!"));

    expect(screen.getByTestId("who")).toHaveTextContent("רונית");
    expect(queryClient.getQueryData(["policies", ""])).toBeUndefined();
  });
});
