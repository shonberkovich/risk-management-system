import { describe, expect, it } from "vitest";

import { formatDateTime, parseServerDate, toDatetimeLocalValue, todayLocalIsoDate } from "./format";

describe("server timestamp parsing", () => {
  it("reads an offset-less date-time as UTC (backend naive-UTC convention)", () => {
    expect(parseServerDate("2026-10-11T08:30:00").getTime()).toBe(Date.UTC(2026, 9, 11, 8, 30));
    expect(parseServerDate("2026-10-11T08:30:00.123456").getTime()).toBe(Date.UTC(2026, 9, 11, 8, 30, 0, 123));
  });

  it("leaves values that already carry an offset, and date-only values, alone", () => {
    expect(parseServerDate("2026-10-11T08:30:00Z").getTime()).toBe(Date.UTC(2026, 9, 11, 8, 30));
    expect(parseServerDate("2026-10-11T08:30:00+03:00").getTime()).toBe(Date.UTC(2026, 9, 11, 5, 30));
    expect(parseServerDate("2026-10-11").getTime()).toBe(new Date("2026-10-11").getTime());
  });

  it("formats a naive-UTC timestamp in local time", () => {
    const utcInstant = new Date(Date.UTC(2026, 9, 11, 8, 30));
    const expected = utcInstant.toLocaleString("he-IL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(formatDateTime("2026-10-11T08:30:00")).toBe(expected);
  });
});

describe("local input values", () => {
  it("formats a Date as a local datetime-local value", () => {
    expect(toDatetimeLocalValue(new Date(2026, 9, 11, 0, 40))).toBe("2026-10-11T00:40");
  });

  it("round-trips a server timestamp into the datetime-local input without shifting it", () => {
    const local = new Date(2026, 9, 11, 0, 40);
    const serverValue = local.toISOString().slice(0, 19); // what the backend stores (naive UTC)
    expect(toDatetimeLocalValue(parseServerDate(serverValue))).toBe("2026-10-11T00:40");
  });

  it("gives today's local calendar date", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(todayLocalIsoDate()).toBe(expected);
  });
});
