/**
 * Component tests for EmailEntityLinkControl.tsx (TODO_SPEC.md "משימה 11" step
 * 3) — the "קשר לישות..." control: picking an entity type loads that entity's
 * option list (reusing fetchProperties/fetchIncidents/fetchClaims), picking an
 * option and clicking "קשר" calls linkEmailToEntity with the right ids, and a
 * success message renders afterwards.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { linkEmailToEntityMock, fetchPropertiesMock, fetchIncidentsMock, fetchClaimsMock } = vi.hoisted(() => ({
  linkEmailToEntityMock: vi.fn(),
  fetchPropertiesMock: vi.fn(),
  fetchIncidentsMock: vi.fn(),
  fetchClaimsMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  linkEmailToEntity: linkEmailToEntityMock,
  fetchProperties: fetchPropertiesMock,
  fetchIncidents: fetchIncidentsMock,
  fetchClaims: fetchClaimsMock,
}));

import EmailEntityLinkControl from "./EmailEntityLinkControl";

const PROPERTIES = [
  { property_id: 1, property_code: "PRP-001", name: "מגדל תל אביב" },
  { property_id: 2, property_code: "PRP-002", name: "מחסן חיפה" },
];

function renderControl(emailId = 42) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<EmailEntityLinkControl emailId={emailId} />, { wrapper });
}

describe("EmailEntityLinkControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPropertiesMock.mockResolvedValue(PROPERTIES);
    fetchIncidentsMock.mockResolvedValue([]);
    fetchClaimsMock.mockResolvedValue([]);
    linkEmailToEntityMock.mockResolvedValue({
      id: 1,
      email_id: 42,
      entity_type: "PROPERTY",
      entity_id: 1,
      linked_by: 9,
      linked_at: "2026-08-22T10:00:00Z",
      auto_linked: false,
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("does not fetch any entity list before a type is picked", () => {
    renderControl();
    expect(fetchPropertiesMock).not.toHaveBeenCalled();
    expect(fetchIncidentsMock).not.toHaveBeenCalled();
    expect(fetchClaimsMock).not.toHaveBeenCalled();
  });

  it("picking PROPERTY loads the property option list, and linking calls linkEmailToEntity with the right ids", async () => {
    renderControl(42);

    await userEvent.click(screen.getByRole("combobox", { name: "קשר לישות..." }));
    await userEvent.click(await screen.findByRole("option", { name: "נכס" }));

    expect(fetchPropertiesMock).toHaveBeenCalled();
    expect(fetchIncidentsMock).not.toHaveBeenCalled();

    const picker = await screen.findByRole("combobox", { name: "בחר..." });
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole("option", { name: "PRP-002 — מחסן חיפה" }));

    const linkButton = await screen.findByRole("button", { name: "קשר" });
    await userEvent.click(linkButton);

    expect(linkEmailToEntityMock).toHaveBeenCalledWith(42, "PROPERTY", 2);
    expect(await screen.findByText("התכתובת קושרה בהצלחה.")).toBeInTheDocument();
  });

  it("shows no link button until an entity has been picked", async () => {
    renderControl();
    await userEvent.click(screen.getByRole("combobox", { name: "קשר לישות..." }));
    await userEvent.click(await screen.findByRole("option", { name: "נכס" }));

    expect(screen.queryByRole("button", { name: "קשר" })).not.toBeInTheDocument();
  });
});
