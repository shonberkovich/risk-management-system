/**
 * uploadEach — a multi-file upload keeps going past a failing file and says which
 * files didn't go up and why (the screens used to stop at the first failure and show
 * a generic message, with the files already uploaded missing from the list).
 */
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { describe, expect, it, vi } from "vitest";

import { uploadEach } from "./uploadEach";

const file = (name: string) => new File(["x"], name);

function apiError(status: number, detail: unknown) {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response = { data: { detail }, status, statusText: "", headers: {}, config } as AxiosResponse;
  return new AxiosError(String(status), "ERR_BAD_REQUEST", config, null, response);
}

describe("uploadEach", () => {
  it("returns null when every file uploads", async () => {
    const upload = vi.fn().mockResolvedValue({});
    expect(await uploadEach([file("a.pdf"), file("b.pdf")], upload)).toBeNull();
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("keeps uploading after a failure and names the failed file with the backend's reason", async () => {
    const upload = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(apiError(400, "הקובץ ריק"))
      .mockResolvedValueOnce({});
    const message = await uploadEach([file("a.pdf"), file("empty.pdf"), file("c.pdf")], upload);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(message).toBe("1 מתוך 3 קבצים לא הועלו: empty.pdf — הקובץ ריק");
  });

  it("falls back to a generic reason for a non-Hebrew error", async () => {
    const upload = vi.fn().mockRejectedValue(new Error("Network Error"));
    expect(await uploadEach([file("a.pdf"), file("b.pdf")], upload)).toBe(
      "העלאת הקבצים נכשלה: a.pdf — ההעלאה נכשלה; b.pdf — ההעלאה נכשלה",
    );
    expect(await uploadEach([file("only.pdf")], upload)).toBe("העלאת הקובץ נכשלה: only.pdf — ההעלאה נכשלה");
  });
});
