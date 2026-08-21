/**
 * Regression coverage for TODO_SPEC.md §14 item 2 ("באנר התראות חירום מרחביות (פיקוד
 * העורף)"): AlertsBanner must render a critical banner for every company property that
 * GET /api/integrations/home-front/alerts reports as matched to an active alert area,
 * and must stay silent (render nothing) when there is nothing to show from any of its
 * three sources — matching the pre-existing "renders nothing" contract for the
 * threshold/weather alert props.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { HomeFrontAlerts } from "../api/client";
import AlertsBanner from "./AlertsBanner";

describe("AlertsBanner — Home Front Command alerts", () => {
  it("renders nothing when alerts, weatherAlerts and homeFrontAlerts are all empty", () => {
    const { container } = render(<AlertsBanner alerts={[]} weatherAlerts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a critical banner for an affected property, listing the matching alert title(s)", () => {
    const homeFrontAlerts: HomeFrontAlerts = {
      status: "active",
      alerts: [{ category: "MISSILES", title: "ירי רקטות וטילים", areas: ["תל אביב - מרכז"] }],
      source_system: "HOME-FRONT-COMMAND",
      affected_properties: [
        {
          property_id: 1,
          property_code: "PRP-001",
          name: "מרכז לוגיסטי תל אביב",
          region: "מרכז",
          matched_area: "תל אביב - מרכז",
        },
      ],
    };

    render(<AlertsBanner alerts={[]} weatherAlerts={[]} homeFrontAlerts={homeFrontAlerts} />);

    expect(screen.getByText(/התראת פיקוד העורף/)).toBeInTheDocument();
    expect(screen.getByText(/מרכז לוגיסטי תל אביב/)).toBeInTheDocument();
    expect(screen.getByText(/ירי רקטות וטילים/)).toBeInTheDocument();
  });

  it("renders nothing for home-front alerts that matched no company property (the normal all-clear state)", () => {
    const homeFrontAlerts: HomeFrontAlerts = {
      status: "active",
      alerts: [{ category: "MISSILES", title: "ירי רקטות וטילים", areas: ["אילת"] }],
      source_system: "HOME-FRONT-COMMAND",
      affected_properties: [],
    };

    const { container } = render(<AlertsBanner alerts={[]} weatherAlerts={[]} homeFrontAlerts={homeFrontAlerts} />);
    expect(container).toBeEmptyDOMElement();
  });
});
