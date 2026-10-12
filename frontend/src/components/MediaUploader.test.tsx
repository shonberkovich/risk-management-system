/**
 * MediaUploader — files over the 25MB upload limit, and files of a type the backend
 * refuses (routers/media.py), are rejected with an inline warning (not window.alert(),
 * which embedded browsers suppress) while the rest are still staged.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../utils/exif", () => ({ extractExifSummary: vi.fn().mockResolvedValue(null) }));

import MediaUploader from "./MediaUploader";

function fileOfSize(name: string, bytes: number, type = "application/pdf") {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

function pick(files: File[]) {
  const input = screen.getByText("העלה קובץ").querySelector("input[type=file]") as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

describe("MediaUploader — size limit", () => {
  it("stages files within the limit and warns inline about the rest", async () => {
    const onFilesChange = vi.fn();
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(<MediaUploader files={[]} onFilesChange={onFilesChange} />);

    const small = fileOfSize("small.pdf", 1024);
    const huge = fileOfSize("huge.pdf", 26 * 1024 * 1024);
    pick([small, huge]);

    expect(onFilesChange).toHaveBeenCalledWith([small]);
    expect(screen.getByRole("alert")).toHaveTextContent("huge.pdf");
    expect(screen.getByRole("alert")).toHaveTextContent("25MB");
    expect(alertSpy).not.toHaveBeenCalled();

    // Dismissable, and a later pick with nothing too large clears it as well.
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    alertSpy.mockRestore();
  });

  it("does not call onFilesChange when every picked file is too large", () => {
    const onFilesChange = vi.fn();
    render(<MediaUploader files={[]} onFilesChange={onFilesChange} />);

    pick([fileOfSize("a.mp4", 30 * 1024 * 1024, "video/mp4")]);

    expect(onFilesChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("a.mp4");
  });

  it("clears the warning once a later pick has nothing too large", () => {
    render(<MediaUploader files={[]} onFilesChange={vi.fn()} />);
    pick([fileOfSize("big.pdf", 26 * 1024 * 1024)]);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    pick([fileOfSize("ok.pdf", 10)]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("MediaUploader — file types", () => {
  it("offers only the types the backend keeps", () => {
    render(<MediaUploader files={[]} onFilesChange={vi.fn()} />);
    const input = screen.getByText("העלה קובץ").querySelector("input[type=file]") as HTMLInputElement;
    expect(input.accept).toBe(".jpg,.jpeg,.png,.mp4,.mov,.pdf");
  });

  it("stages supported files and warns about the rest by name", () => {
    const onFilesChange = vi.fn();
    render(<MediaUploader files={[]} onFilesChange={onFilesChange} />);

    const photo = fileOfSize("photo.JPG", 10, "image/jpeg");
    const heic = fileOfSize("IMG_1.heic", 10, "image/heic");
    const gif = fileOfSize("anim.gif", 10, "image/gif");
    pick([photo, heic, gif]);

    expect(onFilesChange).toHaveBeenCalledWith([photo]);
    expect(screen.getByRole("alert")).toHaveTextContent("סוג הקובץ לא נתמך");
    expect(screen.getByRole("alert")).toHaveTextContent("IMG_1.heic, anim.gif");
  });
});
