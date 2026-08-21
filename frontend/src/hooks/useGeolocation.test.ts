import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { distanceKm, useGeolocation } from "./useGeolocation";

describe("distanceKm", () => {
  it("returns ~0 for identical coordinates", () => {
    const p = { latitude: 32.0853, longitude: 34.7818 };
    expect(distanceKm(p, p)).toBeCloseTo(0, 6);
  });

  it("computes the known great-circle distance between Tel Aviv and Jerusalem (~54km)", () => {
    const telAviv = { latitude: 32.0853, longitude: 34.7818 };
    const jerusalem = { latitude: 31.7683, longitude: 35.2137 };
    expect(distanceKm(telAviv, jerusalem)).toBeGreaterThan(50);
    expect(distanceKm(telAviv, jerusalem)).toBeLessThan(58);
  });

  it("is symmetric", () => {
    const a = { latitude: 32.8, longitude: 34.9 };
    const b = { latitude: 31.2, longitude: 34.8 };
    expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 9);
  });
});

describe("useGeolocation", () => {
  const originalGeolocation = navigator.geolocation;

  afterEach(() => {
    Object.defineProperty(navigator, "geolocation", { value: originalGeolocation, configurable: true });
    vi.restoreAllMocks();
  });

  it("does nothing until request() is called (no permission prompt on mount)", () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });

    const { result } = renderHook(() => useGeolocation());
    expect(result.current.coords).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("sets coords on a successful fix", () => {
    const getCurrentPosition = vi.fn((success) => {
      success({ coords: { latitude: 32.1, longitude: 34.8 } });
    });
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });

    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.request());

    expect(result.current.coords).toEqual({ latitude: 32.1, longitude: 34.8 });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("maps PERMISSION_DENIED to a Hebrew message that still allows manual selection", () => {
    const PERMISSION_DENIED = 1;
    const getCurrentPosition = vi.fn((_success, error) => {
      error({ code: PERMISSION_DENIED, PERMISSION_DENIED, message: "denied" });
    });
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });

    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.request());

    expect(result.current.error).toBe("הגישה למיקום נדחתה — ניתן לבחור נכס ידנית");
    expect(result.current.loading).toBe(false);
  });

  it("maps any other geolocation error to a generic 'could not locate' message", () => {
    const POSITION_UNAVAILABLE = 2;
    const getCurrentPosition = vi.fn((_success, error) => {
      error({ code: POSITION_UNAVAILABLE, PERMISSION_DENIED: 1, message: "unavailable" });
    });
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });

    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.request());

    expect(result.current.error).toBe("לא ניתן לאתר את המיקום הנוכחי");
  });

  it("reports 'not supported' without touching a missing geolocation API", () => {
    Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });

    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.request());

    expect(result.current.error).toBe("מיקום גיאוגרפי אינו נתמך בדפדפן זה");
    expect(result.current.loading).toBe(false);
  });
});
