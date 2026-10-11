/**
 * useConfirmDialog — the in-app stand-in for window.confirm(): the promise resolves
 * true only on the confirming button, false on cancel/Escape, and a newer prompt
 * supersedes (resolves false) one still open.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { useConfirmDialog, type ConfirmOptions } from "./ConfirmDialog";

const OPTIONS: ConfirmOptions = { title: "מחיקת פריט", message: "למחוק את הפריט?", confirmLabel: "מחיקה", destructive: true };

function Harness({ options = OPTIONS }: { options?: ConfirmOptions }) {
  const [confirmDialog, confirm] = useConfirmDialog();
  const [results, setResults] = useState<string[]>([]);
  const ask = async (opts: ConfirmOptions) => {
    const confirmed = await confirm(opts);
    setResults((prev) => [...prev, `${opts.title}:${confirmed}`]);
  };
  return (
    <>
      <button onClick={() => ask(options)}>ask</button>
      <button onClick={() => ask({ title: "שנייה", message: "שאלה שנייה" })}>ask-second</button>
      <output data-testid="results">{results.join("|")}</output>
      {confirmDialog}
    </>
  );
}

const results = () => screen.getByTestId("results").textContent;

describe("useConfirmDialog", () => {
  it("renders nothing until asked", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the title and message, and resolves true on the confirming button", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("ask"));

    const dialog = await screen.findByRole("dialog", { name: "מחיקת פריט" });
    expect(within(dialog).getByText("למחוק את הפריט?")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "מחיקה" }));

    await waitFor(() => expect(results()).toBe("מחיקת פריט:true"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("resolves false on cancel", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("ask"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "ביטול" }));

    await waitFor(() => expect(results()).toBe("מחיקת פריט:false"));
  });

  it("resolves false on Escape", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("ask"));
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(results()).toBe("מחיקת פריט:false"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it('defaults the confirming button to "אישור"', async () => {
    render(<Harness options={{ title: "שאלה", message: "להמשיך?" }} />);
    await userEvent.click(screen.getByText("ask"));
    const dialog = await screen.findByRole("dialog", { name: "שאלה" });
    expect(within(dialog).getByRole("button", { name: "אישור" })).toBeInTheDocument();
  });

  it("a newer prompt supersedes one still open (the old one resolves false)", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("ask"));
    await screen.findByRole("dialog", { name: "מחיקת פריט" });

    // Fire the second prompt programmatically — the open modal makes the page inert
    // to pointer clicks, but a prompt can still be raised from code (e.g. a timer).
    screen.getByText("ask-second", { selector: "button" }).click();

    const dialog = await screen.findByRole("dialog", { name: "שנייה" });
    await waitFor(() => expect(results()).toBe("מחיקת פריט:false"));
    await userEvent.click(within(dialog).getByRole("button", { name: "אישור" }));
    await waitFor(() => expect(results()).toBe("מחיקת פריט:false|שנייה:true"));
  });
});
