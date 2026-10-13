import { describe, it, expect } from "vitest";
import { notificationHref, unreadBadge } from "../notificationView";

// SPM-71: where selecting a notification goes (AC5), and how the unread count
// reads in the navigation (AC3).

describe("notificationHref", () => {
  it.each(["booking_needs_review", "booking_venue_retired", "booking_venue_unavailable"])(
    "opens the event's Venue tab for %s - the booking is the arrangement to review",
    (type) => {
      expect(notificationHref(type, "EVT-000071")).toBe("/events/EVT-000071/venue");
    }
  );

  it("opens the event's Equipment tab when equipment needs review", () => {
    expect(notificationHref("equipment_unavailable", "EVT-000071")).toBe("/events/EVT-000071/equipment");
  });

  it.each(["coordinator_assigned", "coordinator_unassigned", "event_submitted", "safety_check_submitted"])(
    "opens the event's Overview for %s",
    (type) => {
      expect(notificationHref(type, "EVT-000071")).toBe("/events/EVT-000071");
    }
  );

  it("opens the Overview for a type it does not know, rather than nothing", () => {
    // The base seed writes types no route does yet (event_confirmed,
    // clarification_requested ...).
    expect(notificationHref("event_postponed", "EVT-000071")).toBe("/events/EVT-000071");
  });

  it("links nowhere when the notification is about no event", () => {
    expect(notificationHref("booking_needs_review", null)).toBeNull();
    expect(notificationHref("coordinator_assigned", null)).toBeNull();
  });
});

describe("unreadBadge", () => {
  it("shows nothing when nothing is unread", () => {
    expect(unreadBadge(0)).toBeNull();
  });

  it.each([
    [1, "1"],
    [3, "3"],
    [99, "99"],
  ])("shows %i as %j", (count, label) => {
    expect(unreadBadge(count)).toBe(label);
  });

  it("caps the badge at 99+", () => {
    expect(unreadBadge(100)).toBe("99+");
    expect(unreadBadge(2500)).toBe("99+");
  });

  it("treats a negative or invalid count as nothing to show", () => {
    expect(unreadBadge(-1)).toBeNull();
    expect(unreadBadge(Number.NaN)).toBeNull();
  });
});
