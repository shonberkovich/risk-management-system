/**
 * Component tests for IncidentDetail.tsx — the incident drilldown page: error/
 * loading states, the core incident info block, and the empty-vs-populated
 * states for media/documents/claims sections.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchIncidentDrilldownMock,
  fetchPropertyMock,
  fetchMediaSignedUrlMock,
  fetchDocumentSignedUrlMock,
  fetchDocumentsForEntityMock,
  deleteIncidentMediaMock,
  useAuthMock,
} = vi.hoisted(() => ({
  fetchIncidentDrilldownMock: vi.fn(),
  fetchPropertyMock: vi.fn(),
  fetchMediaSignedUrlMock: vi.fn(),
  fetchDocumentSignedUrlMock: vi.fn(),
  fetchDocumentsForEntityMock: vi.fn(),
  deleteIncidentMediaMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  fetchIncidentDrilldown: fetchIncidentDrilldownMock,
  fetchProperty: fetchPropertyMock,
  fetchMediaSignedUrl: fetchMediaSignedUrlMock,
  fetchDocumentSignedUrl: fetchDocumentSignedUrlMock,
  fetchDocumentsForEntity: fetchDocumentsForEntityMock,
  deleteIncidentMedia: deleteIncidentMediaMock,
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));

import IncidentDetail from "./IncidentDetail";

const INCIDENT = {
  incident_id: 1,
  incident_code: "INC-2026-001",
  property_id: 5,
  incident_timestamp: "2026-03-01T10:00:00",
  hazard_type: "FIRE",
  severity_level: "HIGH",
  operational_impact: "PARTIAL_SHUTDOWN",
  initial_estimated_loss: 250_000,
  description: "שריפה במחסן הראשי",
  status: "UNDER_INVESTIGATION",
  ai_classified: true,
  ai_confidence: 0.87,
  is_draft: false,
  business_interruption_requested: true,
  area_or_building: "מבנה B",
  reported_coordinates: null,
};

const PROPERTY = {
  property_id: 5,
  property_code: "PRP-005",
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
};

function renderPage(id = "1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/incidents/${id}`]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(
    <Routes>
      <Route path="/incidents/:id" element={<IncidentDetail />} />
    </Routes>,
    { wrapper },
  );
}

describe("IncidentDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPropertyMock.mockResolvedValue(PROPERTY);
    fetchMediaSignedUrlMock.mockResolvedValue({ url: "x", download_url: "/x", storage_key: "x", expires_at: 0 });
    fetchDocumentSignedUrlMock.mockResolvedValue({ url: "x", download_url: "/x", storage_key: "x", expires_at: 0 });
    fetchDocumentsForEntityMock.mockResolvedValue([]);
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "RISK_MANAGER" } });
  });

  it("shows a loading spinner before the drilldown resolves", () => {
    fetchIncidentDrilldownMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelector('[role="progressbar"]')).toBeInTheDocument();
  });

  it("shows an error message when the incident isn't found", async () => {
    fetchIncidentDrilldownMock.mockRejectedValue(new Error("404"));
    renderPage();
    expect(await screen.findByText("האירוע המבוקש לא נמצא.")).toBeInTheDocument();
  });

  it("renders core incident info, property, and empty-state sections", async () => {
    fetchIncidentDrilldownMock.mockResolvedValue({ incident: INCIDENT, media: [], claims: [], documents: [] });
    renderPage();

    expect(await screen.findByText("תיק אירוע — INC-2026-001")).toBeInTheDocument();
    // Property name comes from a second query (enabled only once the drilldown
    // resolves) — needs its own await, not just the drilldown's.
    expect(await screen.findByText("מרכז לוגיסטי תל אביב")).toBeInTheDocument();
    expect(screen.getByText(/250,000/)).toBeInTheDocument();
    expect(screen.getByText(/AI \(ביטחון 87%\)/)).toBeInTheDocument();
    expect(screen.getByText("נדרש כיסוי אובדן רווחים")).toBeInTheDocument();
    expect(screen.getByText("שריפה במחסן הראשי")).toBeInTheDocument();

    // Empty states
    expect(screen.getByText("לא צורפה מדיה מהשטח לאירוע זה.")).toBeInTheDocument();
    expect(screen.getByText(/לא צורפו מסמכים ישירות לאירוע/)).toBeInTheDocument();
    expect(screen.getByText("טרם הוגשה תביעה עבור אירוע זה.")).toBeInTheDocument();
  });

  it("falls back to a property-id placeholder while the property query is pending", async () => {
    fetchIncidentDrilldownMock.mockResolvedValue({ incident: INCIDENT, media: [], claims: [], documents: [] });
    fetchPropertyMock.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();

    expect(await screen.findByText("#5")).toBeInTheDocument();
  });

  it("renders media thumbnails and documents when present", async () => {
    fetchIncidentDrilldownMock.mockResolvedValue({
      incident: INCIDENT,
      media: [
        { media_id: 1, incident_id: 1, file_path: "x.jpg", file_type: "image/jpeg", captured_at: "2026-03-01T10:00:00", gps_latitude: 32.05, gps_longitude: 34.77 },
      ],
      claims: [],
      documents: [
        { document_id: 1, entity_type: "INCIDENT", entity_id: 1, s3_url: "x", doc_type: "PHOTO", uploaded_by: null, uploaded_at: "2026-03-01T10:00:00" },
      ],
    });
    renderPage();

    expect(await screen.findByText("תמונות ומדיה מהשטח (1)")).toBeInTheDocument();
    expect(screen.getByText("32.0500, 34.7700")).toBeInTheDocument();
    expect(screen.getByText("מסמכים מצורפים לאירוע (1)")).toBeInTheDocument();
  });

  const MEDIA_ITEM = {
    media_id: 1,
    incident_id: 1,
    file_path: "x.jpg",
    file_type: "image/jpeg",
    captured_at: "2026-03-01T10:00:00",
    gps_latitude: null,
    gps_longitude: null,
  };

  it("shows a media delete button for RISK_MANAGER", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "RISK_MANAGER" } });
    fetchIncidentDrilldownMock.mockResolvedValue({ incident: INCIDENT, media: [MEDIA_ITEM], claims: [], documents: [] });
    renderPage();

    expect(await screen.findByLabelText("מחיקת מדיה")).toBeInTheDocument();
  });

  it("hides the media delete button for a non-delete role (PROPERTY_MANAGER)", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "PROPERTY_MANAGER" } });
    fetchIncidentDrilldownMock.mockResolvedValue({ incident: INCIDENT, media: [MEDIA_ITEM], claims: [], documents: [] });
    renderPage();

    await screen.findByText("תמונות ומדיה מהשטח (1)");
    expect(screen.queryByLabelText("מחיקת מדיה")).not.toBeInTheDocument();
  });

  it("renders a claim card with its payments table when a claim exists", async () => {
    fetchIncidentDrilldownMock.mockResolvedValue({
      incident: INCIDENT,
      media: [],
      documents: [],
      claims: [
        {
          claim_id: 1,
          claim_number: "CLM-001",
          incident_id: 1,
          policy_id: 1,
          claimed_amount: 200_000,
          deductible_applied: 20_000,
          approved_amount: 180_000,
          claim_status: "APPROVED",
          adjuster_name: "דוד לוי",
          expected_payment_date: "2026-04-01",
          payments: [
            { payment_id: 1, claim_id: 1, payment_date: "2026-03-15", amount: 90_000, reference_number: "REF-1", payment_type: "ADVANCE" },
          ],
        },
      ],
    });
    renderPage();

    expect(await screen.findByText("CLM-001")).toBeInTheDocument();
    expect(screen.getByText(/דוד לוי/)).toBeInTheDocument();
    // "90,000" appears twice — once as the claim's "שולם בפועל" summary total,
    // once in the payments table row for that same single payment.
    expect(screen.getAllByText(/90,000/)).toHaveLength(2);
    expect(screen.getByText("REF-1")).toBeInTheDocument();
  });

  it("shows 'no payments yet' for a claim with an empty payments array", async () => {
    fetchIncidentDrilldownMock.mockResolvedValue({
      incident: INCIDENT,
      media: [],
      documents: [],
      claims: [
        {
          claim_id: 1,
          claim_number: "CLM-002",
          incident_id: 1,
          policy_id: 1,
          claimed_amount: 100_000,
          deductible_applied: 10_000,
          approved_amount: 0,
          claim_status: "SUBMITTED",
          adjuster_name: null,
          expected_payment_date: null,
          payments: [],
        },
      ],
    });
    renderPage();

    expect(await screen.findByText("CLM-002")).toBeInTheDocument();
    expect(screen.getByText(/לא שויך/)).toBeInTheDocument();
    expect(screen.getByText("טרם נרשמו תשלומים לתביעה זו.")).toBeInTheDocument();
  });
});
