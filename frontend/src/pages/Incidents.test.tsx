/**
 * Component tests for Incidents.tsx's write-role gates — three independent
 * flags, each mirroring a different backend role set:
 *   - seismic scan trigger: _SEISMIC_TRIGGER_ROLES (RISK_MANAGER/ADMIN)
 *   - investigate/close (status write): _STATUS_WRITE_ROLES
 *     (RISK_MANAGER/PROPERTY_MANAGER/RISK_OFFICER/ADMIN)
 *   - file claim: claims.py's _CLAIMS_WRITE_ROLES (RISK_MANAGER/CFO/ADJUSTER/ADMIN)
 * These used to all be visible unconditionally to every authenticated role —
 * same bug class fixed in Policies.tsx/Mitigation.tsx/Claims.tsx.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchIncidentsMock, fetchPropertiesMock, checkSeismicActivityMock, useAuthMock, fileClaimDialogSpy } =
  vi.hoisted(() => ({
    fetchIncidentsMock: vi.fn(),
    fetchPropertiesMock: vi.fn(),
    checkSeismicActivityMock: vi.fn(),
    useAuthMock: vi.fn(),
    fileClaimDialogSpy: vi.fn(),
  }));

vi.mock("../api/client", () => ({
  fetchIncidents: fetchIncidentsMock,
  fetchProperties: fetchPropertiesMock,
  checkSeismicActivity: checkSeismicActivityMock,
  updateIncidentStatus: vi.fn(),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: useAuthMock }));
vi.mock("../components/FileClaimDialog", () => ({
  default: (props: unknown) => {
    fileClaimDialogSpy(props);
    return null;
  },
}));

import Incidents from "./Incidents";

const INCIDENT = {
  incident_id: 1,
  incident_code: "INC-001",
  property_id: 1,
  incident_timestamp: "2026-01-01T00:00:00",
  hazard_type: "FIRE",
  severity_level: "MEDIUM",
  operational_impact: "PARTIAL_SHUTDOWN",
  initial_estimated_loss: 100_000,
  description: "x",
  status: "NEW",
  ai_classified: false,
  ai_confidence: null,
  is_draft: false,
  business_interruption_requested: false,
  area_or_building: null,
  reported_coordinates: null,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<Incidents />, { wrapper });
}

describe("Incidents — write-role gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchIncidentsMock.mockResolvedValue([INCIDENT]);
    fetchPropertiesMock.mockResolvedValue([]);
  });

  it("ADMIN sees the seismic-scan button, status actions, and file-claim action", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "ADMIN" } });
    renderPage();
    await screen.findByText("INC-001");

    expect(screen.getByText("בצע סריקת רעידות אדמה (GSI)")).toBeInTheDocument();
    expect(screen.getByLabelText("העבר לבדיקה")).toBeInTheDocument(); // investigate
    expect(screen.getByLabelText("סגור אירוע (ללא תביעה)")).toBeInTheDocument(); // close
    expect(screen.getByLabelText("פתח תביעה")).toBeInTheDocument(); // file claim
  });

  it("RISK_OFFICER can change status but cannot trigger seismic scan or file a claim", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "RISK_OFFICER" } });
    renderPage();
    await screen.findByText("INC-001");

    expect(screen.queryByText("בצע סריקת רעידות אדמה (GSI)")).not.toBeInTheDocument();
    expect(screen.getByLabelText("העבר לבדיקה")).toBeInTheDocument();
    expect(screen.getByLabelText("סגור אירוע (ללא תביעה)")).toBeInTheDocument();
    expect(screen.queryByLabelText("פתח תביעה")).not.toBeInTheDocument();
  });

  it("CFO can file a claim but cannot change incident status or trigger seismic scan", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "CFO" } });
    renderPage();
    await screen.findByText("INC-001");

    expect(screen.queryByText("בצע סריקת רעידות אדמה (GSI)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("העבר לבדיקה")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("סגור אירוע (ללא תביעה)")).not.toBeInTheDocument();
    expect(screen.getByLabelText("פתח תביעה")).toBeInTheDocument();
  });

  it("FIELD_WORKER sees no write actions at all, only the view-detail button", async () => {
    useAuthMock.mockReturnValue({ user: { user_id: 1, full_name: "x", role: "FIELD_WORKER" } });
    renderPage();
    await screen.findByText("INC-001");

    expect(screen.queryByText("בצע סריקת רעידות אדמה (GSI)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("העבר לבדיקה")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("סגור אירוע (ללא תביעה)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("פתח תביעה")).not.toBeInTheDocument();
    expect(screen.getByLabelText("תיק אירוע מלא")).toBeInTheDocument(); // read-only nav stays
  });
});
