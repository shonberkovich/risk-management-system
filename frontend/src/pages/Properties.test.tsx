/**
 * Component tests for Properties.tsx — the property grid: role-gated "נכס חדש"
 * button, per-card edit button (role-gated + doesn't trigger the card's own
 * navigation), and navigation to the property detail route on card click.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPropertiesMock, useAuthMock, navigateMock, propertyDialogPropsSpy } = vi.hoisted(() => ({
  fetchPropertiesMock: vi.fn(),
  useAuthMock: vi.fn(),
  navigateMock: vi.fn(),
  propertyDialogPropsSpy: vi.fn(),
}));

vi.mock("../api/client", () => ({ fetchProperties: fetchPropertiesMock }));
vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});
vi.mock("../components/PropertyDialog", () => ({
  default: (props: unknown) => {
    propertyDialogPropsSpy(props);
    return null;
  },
}));

import Properties from "./Properties";

const PROPERTIES = [
  {
    property_id: 1,
    property_code: "PRP-001",
    name: "מרכז לוגיסטי תל אביב",
    address: "רחוב הברזל 3",
    region: "מרכז",
    latitude: 32.09,
    longitude: 34.78,
    asset_type: "LOGISTICS_CENTER",
    replacement_value: 10_000_000,
    book_value: 8_000_000,
    is_active: true,
    risk_profile: null,
    manager_name: null,
    active_policy: null,
  },
  {
    property_id: 2,
    property_code: "PRP-002",
    name: "מחסן חיפה",
    address: "רחוב הנמל 5",
    region: "צפון",
    latitude: 32.8,
    longitude: 35.0,
    asset_type: "INFRASTRUCTURE",
    replacement_value: 5_000_000,
    book_value: 4_000_000,
    is_active: true,
    risk_profile: { flood_risk_score: 4, fire_risk_score: 2, earthquake_risk_score: 1, mfl_amount: 1, has_sprinklers: true, profile_id: 1, survey_date: "2024-01-01", notes: null },
    manager_name: null,
    active_policy: null,
  },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Properties />, { wrapper });
}

describe("Properties", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPropertiesMock.mockResolvedValue(PROPERTIES);
  });

  it("shows a loading spinner before data resolves", () => {
    fetchPropertiesMock.mockReturnValue(new Promise(() => {})); // never resolves
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    const { container } = renderPage();
    expect(container.querySelector('[role="progressbar"]')).toBeInTheDocument();
  });

  it("shows every property once loaded, with the count in the header", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();
    expect(await screen.findByText("רשימת נכסים (2)")).toBeInTheDocument();
    expect(screen.getByText("מרכז לוגיסטי תל אביב")).toBeInTheDocument();
    expect(screen.getByText("מחסן חיפה")).toBeInTheDocument();
  });

  it("shows the risk-score badges only for a property with a risk profile", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();
    await screen.findByText("מחסן חיפה");
    // Only PRP-002 has a risk_profile — its badges render, PRP-001's (null risk_profile) don't.
    expect(screen.getAllByText(/הצפה:/)).toHaveLength(1);
  });

  it('shows "נכס חדש" for a write role (RISK_MANAGER) and opens the create dialog', async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "RISK_MANAGER" } });
    renderPage();
    const createButton = await screen.findByText("נכס חדש");
    await userEvent.click(createButton);
    expect(propertyDialogPropsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, property: null }),
    );
  });

  it('hides "נכס חדש" and the per-card edit button for a non-write role (FIELD_WORKER)', async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "FIELD_WORKER" } });
    renderPage();
    await screen.findByText("מרכז לוגיסטי תל אביב");
    expect(screen.queryByText("נכס חדש")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("עריכה")).not.toBeInTheDocument();
  });

  it("hides write controls entirely when there is no logged-in user", async () => {
    useAuthMock.mockReturnValue({ user: null });
    renderPage();
    await screen.findByText("מרכז לוגיסטי תל אביב");
    expect(screen.queryByText("נכס חדש")).not.toBeInTheDocument();
  });

  it("clicking a property card navigates to its detail route", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();
    const card = await screen.findByText("מרכז לוגיסטי תל אביב");
    await userEvent.click(card);
    expect(navigateMock).toHaveBeenCalledWith("/properties/1");
  });

  it("clicking the edit icon opens the edit dialog with that property, without navigating away", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();
    await screen.findByText("מרכז לוגיסטי תל אביב");
    const editButtons = screen.getAllByLabelText("עריכה");
    await userEvent.click(editButtons[0]);

    expect(propertyDialogPropsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, property: expect.objectContaining({ property_id: 1 }) }),
    );
    // Clicking the edit icon (inside the card) must not also trigger the card's
    // own onClick navigation — the handler calls e.stopPropagation() for this.
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("renders an empty grid without crashing when there are no properties", async () => {
    fetchPropertiesMock.mockResolvedValue([]);
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();
    expect(await screen.findByText("רשימת נכסים (0)")).toBeInTheDocument();
  });
});
