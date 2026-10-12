/**
 * The report wizard's own input rules, matching backend schemas.IncidentCreate: a
 * future incident time and a negative loss keep "המשך" disabled (they only failed on
 * submit before, with a generic "send failed"), the area field is capped at its
 * NVARCHAR(150) column, and a rejected submit names the field.
 *
 * Steps are driven only as far as each rule needs (see
 * IncidentReport.reverseGeocode.test.tsx on why the full wizard isn't driven here).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toDatetimeLocalValue } from "../format";

const { fetchPropertiesMock } = vi.hoisted(() => ({ fetchPropertiesMock: vi.fn() }));

vi.mock("../api/client", () => ({
  classifyIncident: vi.fn(),
  createIncident: vi.fn(),
  fetchIncident: vi.fn(),
  fetchProperties: fetchPropertiesMock,
  reverseGeocode: vi.fn(),
  submitDraftIncident: vi.fn(),
  updateDraftIncident: vi.fn(),
  uploadIncidentMedia: vi.fn(),
}));

import IncidentReport from "./IncidentReport";

const PROPERTY = { property_id: 1, property_code: "PRP-001", name: "מרכז לוגיסטי", latitude: 32.09, longitude: 34.78 };

function renderWizard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<IncidentReport />, { wrapper });
}

async function pickProperty() {
  await userEvent.click(await screen.findByLabelText(/^נכס/));
  await userEvent.click(await screen.findByText("מרכז לוגיסטי (PRP-001)"));
}

describe("IncidentReport — input rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    fetchPropertiesMock.mockResolvedValue([PROPERTY]);
  });

  it("blocks a future incident time and caps the time picker at now", async () => {
    renderWizard();
    await pickProperty();
    const next = screen.getByRole("button", { name: "המשך" });
    expect(next).toBeEnabled();

    const time = screen.getByLabelText("תאריך ושעת האירוע");
    expect(time).toHaveAttribute("max");
    fireEvent.change(time, { target: { value: toDatetimeLocalValue(new Date(Date.now() + 2 * 86_400_000)) } });
    expect(screen.getByText("מועד האירוע לא יכול להיות בעתיד")).toBeInTheDocument();
    expect(next).toBeDisabled();
    expect(screen.getByRole("button", { name: "שמור כטיוטה" })).toBeDisabled();

    fireEvent.change(time, { target: { value: toDatetimeLocalValue(new Date(Date.now() - 3_600_000)) } });
    expect(next).toBeEnabled();
  });

  it("caps the area field at its column length", async () => {
    renderWizard();
    expect(await screen.findByLabelText("אזור / מבנה")).toHaveAttribute("maxlength", "150");
  });

  it("blocks a negative loss estimate", async () => {
    renderWizard();
    await pickProperty();
    await userEvent.click(screen.getByRole("button", { name: "המשך" }));
    await userEvent.click(screen.getByRole("button", { name: "שריפה" }));
    await userEvent.click(screen.getByRole("button", { name: "בינונית" }));
    await userEvent.click(screen.getByRole("button", { name: "השבתה חלקית" }));
    await userEvent.click(screen.getByRole("button", { name: "המשך" }));

    await userEvent.type(screen.getByLabelText("תיאור האירוע"), "שריפה במחסן");
    const loss = screen.getByLabelText("הערכת נזק ראשונית (₪)");
    expect(loss).toHaveAttribute("min", "0");
    fireEvent.change(loss, { target: { value: "-5" } });
    expect(screen.getByText("יש להזין סכום אפס ומעלה")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "המשך" })).toBeDisabled();

    fireEvent.change(loss, { target: { value: "5000" } });
    expect(screen.getByRole("button", { name: "המשך" })).toBeEnabled();
  });
});
