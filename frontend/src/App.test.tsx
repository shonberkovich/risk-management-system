/**
 * App routing — an address with no route shows a "not found" page with a way back,
 * instead of an empty page inside the layout.
 */
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("./auth/AuthContext", () => ({
  useAuth: () => ({ user: { user_id: 1, full_name: "דנה", role: "RISK_MANAGER" }, loading: false }),
}));
vi.mock("./components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("./pages/Dashboard", () => ({ default: () => <div>dashboard page</div> }));
// Routing doesn't need the font files (whose "?url" import Vite may refuse to serve here).
vi.mock("./ui/fonts", () => ({ digitsFontFace: "" }));

import App from "./App";

describe("App routing", () => {
  it("shows a not-found page for an unknown address", () => {
    render(
      <MemoryRouter initialEntries={["/no-such-page"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "הדף לא נמצא" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "חזרה לדשבורד" })).toHaveAttribute("href", "/");
  });

  it("still renders a known route", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText("dashboard page")).toBeInTheDocument();
    expect(screen.queryByText("הדף לא נמצא")).not.toBeInTheDocument();
  });
});
