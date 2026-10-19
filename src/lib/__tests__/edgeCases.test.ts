// Branches of src/lib that no screen can reach by hand - a missing value, a
// rule the form's own pickers already prevent - but which still guard against
// bad data arriving some other way.

import { describe, it, expect } from "vitest";
import { EMPTY, formatDateTime, formatDuration, formatTime, formatVenue } from "@/lib/format";
import { canViewEvent, isAssignedCoordinator } from "@/lib/permissions";
import { isSelfRegisterableRole } from "@/lib/roles";
import { INITIAL, validateForm } from "@/lib/eventForm";
import { INITIAL_VENUE, validateVenueForm } from "@/lib/venueForm";
import { defaultTimes } from "@/lib/venueBookingRequest";
import { widenToGrid } from "@/lib/venueTime";

describe("formatting a value that is missing", () => {
  it("[SPM-7] shows a dash instead of a time, a date-time, a duration or a venue", () => {
    expect(formatTime(null)).toBe(EMPTY);
    expect(formatDateTime("not a date")).toBe(EMPTY);
    expect(formatDuration(null, "2027-03-04T09:00:00.000Z")).toBe(EMPTY);
    expect(formatVenue(null, "HALL-A")).toBe(EMPTY);
  });
});

describe("roles and relationships", () => {
  const event = { organiserId: "o1", organisationId: "org", coordinatorId: "u1", status: "planning" };

  it("[SPM-30][AC3] only a coordinator can be an event's assigned coordinator, whatever its coordinatorId says", () => {
    expect(isAssignedCoordinator({ id: "u1", role: "ops_manager", organisationId: null }, event)).toBe(false);
    expect(isAssignedCoordinator({ id: "u1", role: "coordinator", organisationId: null }, event)).toBe(true);
  });

  it("[SPM-4][AC2] a role the app does not know can view no event", () => {
    expect(canViewEvent({ id: "u1", role: "intern", organisationId: null }, event)).toBe(false);
  });

  it("[SPM-51][AC2] only organisers and attendees may register themselves", () => {
    expect(isSelfRegisterableRole("organiser")).toBe(true);
    expect(isSelfRegisterableRole("attendee")).toBe(true);
    expect(isSelfRegisterableRole("ops_manager")).toBe(false);
  });
});

describe("event form: the same item requested twice", () => {
  it("[SPM-23][AC5][AC7] is refused on submit, even though the picker normally prevents it", () => {
    const row = { equipmentId: "eq-1", quantityRequested: "1", technicalRequirements: "" };

    const errors = validateForm(
      {
        ...INITIAL,
        title: "Gala",
        category: "conference",
        startsAt: "2030-03-04T09:00",
        endsAt: "2030-03-04T17:00",
        expectedAttendance: "100",
        equipment: [row, row],
      },
      "submit"
    );

    expect(errors).toEqual({
      equipment: "Each item can only be requested once — change the quantity instead of adding a second row.",
    });
  });
});

describe("venue form", () => {
  const valid = { ...INITIAL_VENUE, code: "HALL-A", name: "Hall A", building: "Tower 1", maxCapacity: "300" };

  it("[SPM-39][AC4] refuses a time that is not HH:MM", () => {
    expect(validateVenueForm({ ...valid, opensAt: "8am" })).toEqual({ opensAt: "Use 24-hour HH:MM, e.g. 08:00." });
  });

  it("[SPM-39][AC3] refuses the same layout listed twice", () => {
    const layout = { layoutName: "theatre", capacity: "100" };

    expect(validateVenueForm({ ...valid, layouts: [layout, layout] })).toEqual({
      layouts: "Each layout can only be listed once — change its capacity instead.",
    });
  });
});

describe("booking times", () => {
  it("[SPM-93][AC2] offers no default times for an event without a readable time", () => {
    expect(defaultTimes({ startsAt: new Date("not a date"), endsAt: new Date("2027-03-04T10:00:00.000Z") })).toBeNull();
  });

  it("[SPM-93][AC2] widens an interval that ends before it starts without inventing a span", () => {
    const widened = widenToGrid({ startsAt: new Date("2027-03-04T02:10:00.000Z"), endsAt: new Date("2027-03-04T01:50:00.000Z") });
    expect(widened.startsAt.toISOString()).toBe("2027-03-04T02:00:00.000Z");
    expect(widened.endsAt.toISOString()).toBe("2027-03-04T02:00:00.000Z");
  });
});
