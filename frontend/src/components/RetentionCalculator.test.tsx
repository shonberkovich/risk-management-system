import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Property, RetentionRecommendation } from "../api/client";

// Mock the API layer (not axios directly) — this component only ever talks to
// fetchProperties/fetchRetentionRecommendation, so mocking at that boundary keeps the test
// agnostic to how the client is implemented underneath.
const { fetchPropertiesMock, fetchRetentionRecommendationMock } = vi.hoisted(() => ({
  fetchPropertiesMock: vi.fn(),
  fetchRetentionRecommendationMock: vi.fn(),
}));
vi.mock("../api/client", () => ({
  fetchProperties: fetchPropertiesMock,
  fetchRetentionRecommendation: fetchRetentionRecommendationMock,
}));

// Excel export goes through the `xlsx` package and triggers a real file download in a browser
// — irrelevant to this component's own logic and not something jsdom can meaningfully exercise.
const { exportRetentionReportToExcelMock } = vi.hoisted(() => ({ exportRetentionReportToExcelMock: vi.fn() }));
vi.mock("../exportRetentionReport", () => ({
  exportRetentionReportToExcel: exportRetentionReportToExcelMock,
}));

import RetentionCalculator from "./RetentionCalculator";

const INSURED_PROPERTY: Property = {
  property_id: 1,
  property_code: "P-001",
  name: "מרכז לוגיסטי חיפה",
  address: "רח' התעשייה 5",
  region: "צפון",
  latitude: 32.8,
  longitude: 34.9,
  asset_type: "LOGISTICS_CENTER",
  replacement_value: 5_000_000,
  book_value: 4_000_000,
  is_active: true,
  risk_profile: { mfl_amount: 250_000 } as Property["risk_profile"],
  manager_name: "מנהל דוגמה",
  active_policy: {
    policy_id: 10,
    policy_number: "POL-10",
    insurer_name: "הראל",
    total_limit: 1_000_000,
    per_event_limit: 500_000,
    specific_deductible: 20_000,
  },
};

const UNINSURED_PROPERTY: Property = {
  ...INSURED_PROPERTY,
  property_id: 2,
  name: "נכס ללא פוליסה",
  active_policy: null,
};

const RECOMMENDATION: RetentionRecommendation = {
  policy_id: 10,
  property_id: 1,
  estimated_loss: 250_000,
  deductible: 20_000,
  claim_recoverable_amount: 230_000,
  claim_out_of_pocket: 20_000,
  expected_premium_surcharge: 5_000,
  claim_total_cost: 25_000,
  absorb_total_cost: 250_000,
  recommendation: "CLAIM",
  estimated_savings: 225_000,
  incident_id: null,
};

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("RetentionCalculator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPropertiesMock.mockResolvedValue([INSURED_PROPERTY, UNINSURED_PROPERTY]);
  });

  it("only lists properties that have an active policy", async () => {
    renderWithClient(<RetentionCalculator />);
    const select = await screen.findByLabelText("נכס מבוטח");
    await userEvent.click(select);
    expect(await screen.findByRole("option", { name: INSURED_PROPERTY.name })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: UNINSURED_PROPERTY.name })).not.toBeInTheDocument();
  });

  it("pre-fills the estimated loss from the property's surveyed MFL on selection", async () => {
    renderWithClient(<RetentionCalculator />);
    const select = await screen.findByLabelText("נכס מבוטח");
    await userEvent.click(select);
    await userEvent.click(await screen.findByRole("option", { name: INSURED_PROPERTY.name }));

    const lossInput = screen.getByLabelText("נזק משוער (₪)") as HTMLInputElement;
    await waitFor(() => expect(lossInput.value).toBe("250000"));
  });

  it("runs the recommendation query with the selected property/policy/loss and renders the result", async () => {
    fetchRetentionRecommendationMock.mockResolvedValue(RECOMMENDATION);
    renderWithClient(<RetentionCalculator />);

    const select = await screen.findByLabelText("נכס מבוטח");
    await userEvent.click(select);
    await userEvent.click(await screen.findByRole("option", { name: INSURED_PROPERTY.name }));

    await userEvent.click(screen.getByRole("button", { name: "חשב המלצה" }));

    await waitFor(() =>
      expect(fetchRetentionRecommendationMock).toHaveBeenCalledWith({
        policy_id: 10,
        property_id: 1,
        estimated_loss: 250_000,
      }),
    );

    expect(await screen.findByText("המלצה: להגיש תביעה")).toBeInTheDocument();
    // Both cost columns render with the mocked figures ("עלות כוללת" appears once per card).
    expect(screen.getAllByText("עלות כוללת")).toHaveLength(2);
    // Intl currency formatting inserts bidi control characters around the symbol/amount that
    // don't survive a literal string match reliably across ICU builds — match on the digits
    // instead of the exact formatted string.
    expect(screen.getAllByText((_, el) => el?.textContent?.replace(/\D/g, "") === "20000").length).toBeGreaterThan(0);
    expect(screen.getAllByText((_, el) => el?.textContent?.replace(/\D/g, "") === "230000").length).toBeGreaterThan(0);
  });

  it("keeps the calculate button disabled until a property and a positive loss are set", async () => {
    renderWithClient(<RetentionCalculator />);
    const button = await screen.findByRole("button", { name: "חשב המלצה" });
    expect(button).toBeDisabled();

    const select = await screen.findByLabelText("נכס מבוטח");
    await userEvent.click(select);
    await userEvent.click(await screen.findByRole("option", { name: INSURED_PROPERTY.name }));
    // MFL auto-fill makes it a positive number already, so the button should now be enabled.
    await waitFor(() => expect(button).toBeEnabled());

    const lossInput = screen.getByLabelText("נזק משוער (₪)");
    await userEvent.clear(lossInput);
    expect(button).toBeDisabled();
  });

  it("shows an info alert instead of a dropdown when no property has an active policy", async () => {
    fetchPropertiesMock.mockResolvedValue([UNINSURED_PROPERTY]);
    renderWithClient(<RetentionCalculator />);
    expect(await screen.findByText("אין נכסים עם פוליסה פעילה במערכת כרגע.")).toBeInTheDocument();
  });

  it("invokes the Excel export with the selected property and the fetched recommendation", async () => {
    fetchRetentionRecommendationMock.mockResolvedValue(RECOMMENDATION);
    renderWithClient(<RetentionCalculator />);

    const select = await screen.findByLabelText("נכס מבוטח");
    await userEvent.click(select);
    await userEvent.click(await screen.findByRole("option", { name: INSURED_PROPERTY.name }));
    await userEvent.click(screen.getByRole("button", { name: "חשב המלצה" }));
    await screen.findByText("המלצה: להגיש תביעה");

    await userEvent.click(screen.getByRole("button", { name: "ייצוא ל-Excel" }));
    expect(exportRetentionReportToExcelMock).toHaveBeenCalledWith(
      expect.objectContaining({ property_id: 1 }),
      RECOMMENDATION,
    );
  });
});
