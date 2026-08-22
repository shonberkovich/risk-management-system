/**
 * Component tests for EmailSidebar.tsx's TODO_SPEC.md "משימה 16" additions:
 * the "צור תיקייה/תגית חדשה" create-label form (name + color swatch, calling
 * createLabel), the user's labels rendered as sidebar entries below the
 * fixed folders, and clicking one toggling it as the active filter via
 * `onSelectLabel`.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchEmailsMock, fetchLabelsMock, createLabelMock, deleteLabelMock } = vi.hoisted(() => ({
  fetchEmailsMock: vi.fn(),
  fetchLabelsMock: vi.fn(),
  createLabelMock: vi.fn(),
  deleteLabelMock: vi.fn(),
}));

vi.mock("../api/client", () => ({
  fetchEmails: fetchEmailsMock,
  fetchLabels: fetchLabelsMock,
  createLabel: createLabelMock,
  deleteLabel: deleteLabelMock,
}));

import EmailSidebar from "./EmailSidebar";

const URGENT_LABEL = { id: 5, name: "דחוף", color: "#e53935" };

function renderSidebar(props: Partial<React.ComponentProps<typeof EmailSidebar>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const onSelect = props.onSelect ?? vi.fn();
  const onSelectLabel = props.onSelectLabel ?? vi.fn();
  const utils = render(
    <EmailSidebar selected="INBOX" onSelect={onSelect} activeLabelId={null} onSelectLabel={onSelectLabel} {...props} />,
    { wrapper },
  );
  return { ...utils, onSelect, onSelectLabel };
}

describe("EmailSidebar labels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchEmailsMock.mockResolvedValue([]);
    fetchLabelsMock.mockResolvedValue([]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("renders the fixed folders and no label section entries when there are no labels", async () => {
    renderSidebar();
    expect(await screen.findByTestId("email-folder-INBOX")).toBeInTheDocument();
    expect(screen.getByText("תגיות")).toBeInTheDocument();
    expect(screen.queryByTestId(/email-label-/)).not.toBeInTheDocument();
  });

  it("renders each of the user's labels as a sidebar entry", async () => {
    fetchLabelsMock.mockResolvedValue([URGENT_LABEL, { id: 6, name: "אישור מנהל", color: "#1e88e5" }]);
    renderSidebar();

    expect(await screen.findByTestId("email-label-5")).toHaveTextContent("דחוף");
    expect(screen.getByTestId("email-label-6")).toHaveTextContent("אישור מנהל");
  });

  it("clicking a label calls onSelectLabel with its id", async () => {
    fetchLabelsMock.mockResolvedValue([URGENT_LABEL]);
    const { onSelectLabel } = renderSidebar();

    await userEvent.click(await screen.findByTestId("email-label-5"));
    expect(onSelectLabel).toHaveBeenCalledWith(5);
  });

  it("clicking the already-active label clears the filter (calls onSelectLabel with null)", async () => {
    fetchLabelsMock.mockResolvedValue([URGENT_LABEL]);
    const { onSelectLabel } = renderSidebar({ activeLabelId: 5 });

    await userEvent.click(await screen.findByTestId("email-label-5"));
    expect(onSelectLabel).toHaveBeenCalledWith(null);
  });

  it("the create-label form is collapsed by default, and submitting it calls createLabel with the chosen name/color", async () => {
    createLabelMock.mockResolvedValue({ id: 7, name: "תביעות דחופות", color: "#fb8c00" });
    renderSidebar();

    expect(screen.queryByTestId("create-label-name-input")).not.toBeInTheDocument();
    await userEvent.click(await screen.findByTestId("open-create-label-form"));

    const nameInput = screen.getByTestId("create-label-name-input").querySelector("input")!;
    await userEvent.type(nameInput, "תביעות דחופות");
    await userEvent.click(screen.getByTestId("label-color-swatch-#fb8c00"));
    await userEvent.click(screen.getByTestId("create-label-submit"));

    await waitFor(() => expect(createLabelMock).toHaveBeenCalledWith({ name: "תביעות דחופות", color: "#fb8c00" }));
  });

  it("the create-label submit button is disabled until a name is entered", async () => {
    renderSidebar();
    await userEvent.click(await screen.findByTestId("open-create-label-form"));
    expect(screen.getByTestId("create-label-submit")).toBeDisabled();

    const nameInput = screen.getByTestId("create-label-name-input").querySelector("input")!;
    await userEvent.type(nameInput, "x");
    expect(screen.getByTestId("create-label-submit")).not.toBeDisabled();
  });

  it("clicking a label's delete icon calls deleteLabel", async () => {
    fetchLabelsMock.mockResolvedValue([URGENT_LABEL]);
    deleteLabelMock.mockResolvedValue(undefined);
    renderSidebar();

    await userEvent.click(await screen.findByLabelText("מחק תגית דחוף"));
    expect(deleteLabelMock).toHaveBeenCalledWith(5);
  });
});
