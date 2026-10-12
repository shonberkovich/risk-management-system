import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { describe, expect, it } from "vitest";

import { apiErrorMessage } from "./errors";

function failure(status: number, data: unknown): AxiosError {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response = { data, status, statusText: "", headers: {}, config } as AxiosResponse;
  return new AxiosError(`status ${status}`, "ERR_BAD_REQUEST", config, null, response);
}

describe("apiErrorMessage", () => {
  it("shows a Hebrew detail from the backend as is", () => {
    const err = failure(400, { detail: "לא ניתן להשבית את המשתמש המחובר (עצמך)" });
    expect(apiErrorMessage(err, "נכשל")).toBe("לא ניתן להשבית את המשתמש המחובר (עצמך)");
  });

  it("falls back on an English (developer) detail", () => {
    expect(apiErrorMessage(failure(404, { detail: "Property not found" }), "נכשל")).toBe("נכשל");
  });

  it("names the first invalid field of a 422", () => {
    const err = failure(422, {
      detail: [
        { loc: ["body", "area_or_building"], type: "string_too_long", msg: "String should have at most 150 characters", ctx: { max_length: 150 } },
      ],
    });
    expect(apiErrorMessage(err, "נכשל", { area_or_building: "אזור / מבנה" })).toBe("אזור / מבנה: ארוך מדי (עד 150 תווים)");
  });

  it("uses the schema's own Hebrew text for a value error", () => {
    const err = failure(422, {
      detail: [{ loc: ["body", "title"], type: "value_error", msg: "Value error, שדה חובה — לא ניתן להשאיר ריק" }],
    });
    expect(apiErrorMessage(err, "נכשל", { title: "כותרת" })).toBe("כותרת: שדה חובה — לא ניתן להשאיר ריק");
  });

  it("describes a lower bound and leaves an unlabelled field unnamed", () => {
    const err = failure(422, {
      detail: [{ loc: ["body", "cost_estimate"], type: "greater_than_equal", msg: "...", ctx: { ge: 0 } }],
    });
    expect(apiErrorMessage(err, "נכשל")).toBe("חייב להיות 0 ומעלה");
  });

  it("falls back on an unknown 422 type, a network error and a non-axios error", () => {
    expect(apiErrorMessage(failure(422, { detail: [{ loc: ["body", "x"], type: "json_invalid", msg: "bad" }] }), "נכשל")).toBe("נכשל");
    expect(apiErrorMessage(new AxiosError("Network Error", "ERR_NETWORK"), "נכשל")).toBe("נכשל");
    expect(apiErrorMessage(new Error("boom"), "נכשל")).toBe("נכשל");
  });
});
