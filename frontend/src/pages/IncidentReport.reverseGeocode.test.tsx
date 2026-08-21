/**
 * Regression coverage for TODO_SPEC.md §14 item 1 ("עדכון אשף הדיווח: השלמת כתובת
 * אוטומטית"): once a GPS fix resolves, IncidentReport calls the reverse-geocoding
 * endpoint and autofills the "אזור / מבנה" field with the returned address — additive
 * to the pre-existing nearest-property auto-select, and never overwriting a value the
 * user typed in themselves. A failed geocode call must not block the form: the field is
 * simply left for manual entry (same graceful-degradation pattern as the AI classify
 * button, see CopilotWidget/classifyMutation.isError elsewhere in this file).
 *
 * Only step 0 of the wizard is exercised here — like IncidentReport.networkMode.test.tsx,
 * this deliberately avoids driving the full multi-step wizard (media upload, AI
 * classification, offline queueing) which is heavy to mock and already covered by other
 * tests / by the project's browser-based verification convention documented in
 * TODO_SPEC.md.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPropertiesMock, reverseGeocodeMock } = vi.hoisted(() => ({
  fetchPropertiesMock: vi.fn(),
  reverseGeocodeMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  classifyIncident: vi.fn(),
  createIncident: vi.fn(),
  fetchIncident: vi.fn(),
  fetchProperties: fetchPropertiesMock,
  reverseGeocode: reverseGeocodeMock,
  submitDraftIncident: vi.fn(),
  updateDraftIncident: vi.fn(),
  uploadIncidentMedia: vi.fn(),
}));

import IncidentReport from "./IncidentReport";

const PROPERTY = {
  property_id: 1,
  property_code: "PRP-001",
  name: "מרכז לוגיסטי תל אביב",
  latitude: 32.09,
  longitude: 34.78,
};

function renderWizard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<IncidentReport />, { wrapper });
}

function mockGeolocationFix(latitude: number, longitude: number) {
  const getCurrentPosition = vi.fn((success) => success({ coords: { latitude, longitude } }));
  Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
}

describe("IncidentReport — reverse-geocoding autofill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPropertiesMock.mockResolvedValue([PROPERTY]);
  });

  it("autofills the אזור / מבנה field with the resolved address after a GPS fix", async () => {
    reverseGeocodeMock.mockResolvedValue({ status: "ok", address: "רחוב הברזל 3, תל אביב", source_system: "OSM-NOMINATIM" });
    mockGeolocationFix(32.09, 34.78);

    renderWizard();
    await userEvent.click(await screen.findByText("אתר את מיקומי והצע נכסים קרובים"));

    await waitFor(() => expect(reverseGeocodeMock).toHaveBeenCalledWith(32.09, 34.78));
    await waitFor(() =>
      expect(screen.getByLabelText("אזור / מבנה")).toHaveValue("רחוב הברזל 3, תל אביב"),
    );
  });

  it("does not block the form when reverse geocoding fails — leaves the field empty for manual entry", async () => {
    reverseGeocodeMock.mockRejectedValue(new Error("network error"));
    mockGeolocationFix(32.09, 34.78);

    renderWizard();
    await userEvent.click(await screen.findByText("אתר את מיקומי והצע נכסים קרובים"));

    await waitFor(() => expect(reverseGeocodeMock).toHaveBeenCalled());
    expect(await screen.findByText("לא ניתן היה לאתר כתובת אוטומטית — ניתן למלא ידנית.")).toBeInTheDocument();
    expect(screen.getByLabelText("אזור / מבנה")).toHaveValue("");
    // The property Autocomplete (nearest-property auto-select) is unaffected by the
    // geocode failure — this feature is additive, never blocking.
    expect(await screen.findByDisplayValue(/מרכז לוגיסטי תל אביב/)).toBeInTheDocument();
  });

  it("never overwrites a manually-typed value with a later geocode result", async () => {
    reverseGeocodeMock.mockResolvedValue({ status: "ok", address: "כתובת אוטומטית", source_system: "OSM-NOMINATIM" });
    mockGeolocationFix(32.09, 34.78);

    renderWizard();
    await userEvent.click(await screen.findByText("אתר את מיקומי והצע נכסים קרובים"));
    await waitFor(() => expect(screen.getByLabelText("אזור / מבנה")).toHaveValue("כתובת אוטומטית"));

    const field = screen.getByLabelText("אזור / מבנה");
    await userEvent.clear(field);
    await userEvent.type(field, "מבנה B, קומה 2");
    expect(field).toHaveValue("מבנה B, קומה 2");

    // A second GPS fix / geocode resolution must not clobber the manual edit.
    reverseGeocodeMock.mockResolvedValue({ status: "ok", address: "כתובת אוטומטית אחרת", source_system: "OSM-NOMINATIM" });
    mockGeolocationFix(32.1, 34.79);
    await userEvent.click(await screen.findByText("אתר את מיקומי והצע נכסים קרובים"));

    await waitFor(() => expect(reverseGeocodeMock).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("אזור / מבנה")).toHaveValue("מבנה B, קומה 2");
  });
});
