/**
 * Tests for OutOfOfficeBanner.tsx — TODO_SPEC.md "משימה 18" step 5: the small
 * yellow warning banner shown in the email UI while the *current* user's own
 * out-of-office auto-responder is active (enabled AND today within
 * [auto_reply_start, auto_reply_end]).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CurrentUser } from "../api/client";
import OutOfOfficeBanner, { isAutoResponderActive } from "./OutOfOfficeBanner";

function makeUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    user_id: 1,
    full_name: "יוסי כהן",
    role: "RISK_MANAGER",
    signature: null,
    auto_reply_enabled: false,
    auto_reply_start: null,
    auto_reply_end: null,
    auto_reply_body: null,
    ...overrides,
  };
}

function todayPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("isAutoResponderActive", () => {
  it("is false for null/undefined user", () => {
    expect(isAutoResponderActive(null)).toBe(false);
    expect(isAutoResponderActive(undefined)).toBe(false);
  });

  it("is false when disabled, even with a valid range covering today", () => {
    const user = makeUser({ auto_reply_enabled: false, auto_reply_start: todayPlusDays(-1), auto_reply_end: todayPlusDays(1) });
    expect(isAutoResponderActive(user)).toBe(false);
  });

  it("is false when enabled but the dates are missing", () => {
    expect(isAutoResponderActive(makeUser({ auto_reply_enabled: true }))).toBe(false);
    expect(isAutoResponderActive(makeUser({ auto_reply_enabled: true, auto_reply_start: todayPlusDays(-1) }))).toBe(false);
  });

  it("is true when enabled and today is within [start, end] inclusive", () => {
    const user = makeUser({ auto_reply_enabled: true, auto_reply_start: todayPlusDays(0), auto_reply_end: todayPlusDays(0) });
    expect(isAutoResponderActive(user)).toBe(true);
  });

  it("is false when today is before the start date", () => {
    const user = makeUser({ auto_reply_enabled: true, auto_reply_start: todayPlusDays(1), auto_reply_end: todayPlusDays(5) });
    expect(isAutoResponderActive(user)).toBe(false);
  });

  it("is false when today is after the end date", () => {
    const user = makeUser({ auto_reply_enabled: true, auto_reply_start: todayPlusDays(-5), auto_reply_end: todayPlusDays(-1) });
    expect(isAutoResponderActive(user)).toBe(false);
  });
});

describe("OutOfOfficeBanner", () => {
  it("renders nothing when there is no user", () => {
    const { container } = render(<OutOfOfficeBanner user={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the auto-responder is off", () => {
    const { container } = render(<OutOfOfficeBanner user={makeUser()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the warning banner with the spec's exact wording when active", () => {
    const user = makeUser({ auto_reply_enabled: true, auto_reply_start: todayPlusDays(-1), auto_reply_end: todayPlusDays(1) });
    render(<OutOfOfficeBanner user={user} />);
    expect(screen.getByTestId("out-of-office-banner")).toHaveTextContent("מענה אוטומטי מופעל כעת");
  });

  it("renders nothing once the range has passed", () => {
    const user = makeUser({ auto_reply_enabled: true, auto_reply_start: todayPlusDays(-10), auto_reply_end: todayPlusDays(-1) });
    const { container } = render(<OutOfOfficeBanner user={user} />);
    expect(container).toBeEmptyDOMElement();
  });
});
