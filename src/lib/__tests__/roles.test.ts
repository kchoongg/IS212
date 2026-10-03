import { describe, it, expect } from "vitest";
import {
  ROLES,
  activeNavHref,
  eventTabsFor,
  isExternalRole,
  navFor,
  roleLabel,
} from "../roles";

// Traces to SPM-7: "the interface is consistent across user roles" and
// "the design supports the different workflows for the five user roles".

describe("roleLabel", () => {
  it("gives every role a human label", () => {
    for (const role of ROLES) {
      expect(roleLabel(role)).not.toContain("_");
      expect(roleLabel(role)).toMatch(/^[A-Z]/);
    }
  });

  it("falls back to the raw value for an unknown role rather than throwing", () => {
    expect(roleLabel("future_role")).toBe("future_role");
  });
});

describe("navFor", () => {
  it("gives every role a navigation set", () => {
    for (const role of ROLES) {
      expect(navFor(role).length).toBeGreaterThan(0);
    }
  });

  it("starts every role at the dashboard, so the chrome is the same everywhere", () => {
    for (const role of ROLES) {
      expect(navFor(role)[0].href).toBe("/dashboard");
    }
  });

  it("does not offer organisers internal screens", () => {
    const hrefs = navFor("organiser").map((item) => item.href);
    expect(hrefs).not.toContain("/venues");
    expect(hrefs).not.toContain("/bookings");
    expect(hrefs).not.toContain("/queue");
  });

  it("does not offer attendees any planning screens", () => {
    const hrefs = navFor("attendee").map((item) => item.href);
    expect(hrefs).toEqual(["/dashboard", "/browse", "/registrations", "/notifications"]);
  });

  it("degrades to the dashboard for an unknown role instead of an empty sidebar", () => {
    expect(navFor("future_role")).toEqual([{ href: "/dashboard", label: "Dashboard" }]);
  });
});

describe("eventTabsFor", () => {
  it("shows every role the overview", () => {
    for (const role of ROLES) {
      expect(eventTabsFor(role)).toContain("overview");
    }
  });

  it("keeps internal planning tabs away from external roles", () => {
    // Briefing §8b: an Attendee must not see internal planning information.
    expect(eventTabsFor("attendee")).toEqual(["overview"]);
    expect(eventTabsFor("organiser")).not.toContain("readiness");
    expect(eventTabsFor("organiser")).not.toContain("history");
  });

  it("gives the coordinator every tab", () => {
    expect(eventTabsFor("coordinator")).toContain("readiness");
    expect(eventTabsFor("coordinator")).toContain("history");
  });

  it("limits venue staff to the venue side and tech support to equipment", () => {
    expect(eventTabsFor("venue_staff")).toEqual(["overview", "venue"]);
    expect(eventTabsFor("tech_support")).toEqual(["overview", "equipment"]);
  });
});

describe("isExternalRole", () => {
  it("classifies organisers and attendees as external", () => {
    expect(isExternalRole("organiser")).toBe(true);
    expect(isExternalRole("attendee")).toBe(true);
  });

  it("classifies ConnectSphere staff as internal", () => {
    expect(isExternalRole("coordinator")).toBe(false);
    expect(isExternalRole("venue_staff")).toBe(false);
    expect(isExternalRole("tech_support")).toBe(false);
    expect(isExternalRole("ops_manager")).toBe(false);
  });
});

describe("activeNavHref", () => {
  const techSupport = navFor("tech_support");

  it("highlights only Equipment Requests on the requests queue, not Equipment as well", () => {
    expect(activeNavHref(techSupport, "/equipment/requests")).toBe("/equipment/requests");
  });

  it("keeps Equipment Requests highlighted on one event's request page", () => {
    expect(activeNavHref(techSupport, "/equipment/requests/EVT-000123")).toBe("/equipment/requests");
  });

  it("highlights Equipment on the catalogue itself", () => {
    expect(activeNavHref(techSupport, "/equipment")).toBe("/equipment");
  });

  it("keeps a section highlighted on the pages under it", () => {
    expect(activeNavHref(navFor("organiser"), "/events/EVT-000123/equipment")).toBe("/events");
  });

  it("does not treat a shared prefix as a match", () => {
    expect(activeNavHref([{ href: "/events", label: "Events" }], "/eventsx")).toBeNull();
  });

  it("highlights nothing when no link matches", () => {
    expect(activeNavHref(techSupport, "/profile")).toBeNull();
  });
});
