// SPM-68, Review Flagged Arrangements. Written before the code; what these tests hold it to:
//   src/lib/flaggedArrangements.ts, pure functions over plain data:
//     flagReasons(reviewReason)            the stored reason codes, in words
//     assessFlaggedBooking(input)          { suitability: { ok, unmet }, availability: { ok, unmet } }
//     assessFlaggedEquipment(line)         { ok, needed, available, summary }
//     keepRefusal(name, unmet)             the message when Keep is refused
//     registrationCountLine(registered, waitlisted)
// Decided here, not in the story (change the test if the team wants otherwise):
//   - a reason code nobody has taught this file is shown in plain words, and a
//     flag with no code reads "no reason was recorded" (as the Readiness tab)
//   - availability of a booking = the venue is not retired, the booking still
//     covers the event's (or session's) present time, and nothing else holds
//     or blocks the room for the booking's occupied time (SPM-44's rule)
//   - a held equipment line needs the quantity it has reserved; one not yet
//     reserved needs the quantity requested
//   - the wording of every message below

import { describe, it, expect } from "vitest";
import {
  assessFlaggedBooking,
  assessFlaggedEquipment,
  flagReasons,
  followsEvent,
  keepRefusal,
  spaceNeeds,
  registrationCountLine,
  type FlaggedBookingInput,
} from "../flaggedArrangements";

/// A Singapore wall-clock hour on a day, as the instant the database stores.
const at = (day: string, hour: number, minute = 0) =>
  new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), hour - 8, minute));

const DAY = "2027-10-08";

function input(overrides: Partial<FlaggedBookingInput> = {}): FlaggedBookingInput {
  return {
    booking: { id: "b1", eventId: "e1", status: "approved", startsAt: at(DAY, 9), endsAt: at(DAY, 17) },
    schedule: { startsAt: at(DAY, 9), endsAt: at(DAY, 17) },
    holder: "event",
    needs: { expectedAttendance: 80, preferredLayout: "theatre", requirements: [] },
    venue: {
      name: "Hall",
      isActive: true,
      setupMinutes: 0,
      teardownMinutes: 0,
      layouts: [{ layoutName: "theatre", capacity: 100 }],
      facilityIds: ["f-projector"],
      bookings: [],
      unavailability: [],
    },
    ...overrides,
  };
}

const venue = (overrides: Partial<FlaggedBookingInput["venue"]> = {}) => ({ ...input().venue, ...overrides });

describe("flagReasons - why an arrangement was flagged, in words (AC2, AC8)", () => {
  it("words a change to the event and a change to the venue alike, in the stored order", () => {
    expect(flagReasons("event_schedule_changed,venue_retired")).toEqual([
      "the date or time changed",
      "the venue has been retired",
    ]);
  });

  it.each([
    ["event_attendance_changed", "the expected attendance changed"],
    ["event_requirements_changed", "the venue requirements changed"],
    ["layout_capacity_below_attendance", "the booked layout no longer seats the expected attendance"],
    ["venue_unavailable", "the venue is unavailable during this booking"],
    ["equipment_unavailable", "units of the equipment were marked out of service"],
    ["registration_capacity_lowered", "the registration capacity was lowered below the number registered or waitlisted"],
    ["registration_disabled", "registration was turned off"],
    // SPM-88 (AC3).
    ["safety_check_returned", "the Safety Officer returned the safety check"],
  ])("words %s", (code, words) => {
    expect(flagReasons(code)).toEqual([words]);
  });

  it("shows a code it has not been taught in plain words, rather than hiding the flag", () => {
    expect(flagReasons("venue_turnaround_changed")).toEqual(["venue turnaround changed"]);
  });

  it("ignores stray spaces and empty entries", () => {
    expect(flagReasons(" venue_retired , ,event_schedule_changed")).toEqual([
      "the venue has been retired",
      "the date or time changed",
    ]);
  });

  it.each([null, undefined, ""])("says no reason was recorded for %j", (stored) => {
    expect(flagReasons(stored)).toEqual(["no reason was recorded"]);
  });
});

// SPM-90: each booking is for a space. The main programme follows the event;
// any other space is judged on its own figures, as booked.
describe("spaceNeeds - which attendance and layout a booking is held to now (SPM-90)", () => {
  const event = { expectedAttendance: 150, preferredLayout: "theatre" };

  it.each([
    ["the main programme", "Main programme"],
    ["the main programme, however it is capitalised or spaced", "  main PROGRAMME "],
    ["a booking made before SPM-90, with no space", null],
    ["a booking with an empty purpose", ""],
  ])("holds %s to the event's present attendance and layout", (_what, purpose) => {
    expect(spaceNeeds({ purpose, expectedAttendance: 80, layoutName: "classroom" }, event)).toEqual(event);
    expect(followsEvent(purpose)).toBe(true);
  });

  it("holds any other space to its own attendance and layout, as booked", () => {
    expect(spaceNeeds({ purpose: "Breakout room", expectedAttendance: 30, layoutName: "classroom" }, event)).toEqual({
      expectedAttendance: 30,
      preferredLayout: "classroom",
    });
    expect(followsEvent("Breakout room")).toBe(false);
  });

  it("falls back to the event's attendance for a space with none recorded, and checks no layout it did not set", () => {
    expect(spaceNeeds({ purpose: "Breakout room", expectedAttendance: null, layoutName: null }, event)).toEqual({
      expectedAttendance: 150,
      preferredLayout: null,
    });
  });

  it("does not let an event that grew make a breakout room too small for its own attendance", () => {
    const breakout = spaceNeeds({ purpose: "Breakout room", expectedAttendance: 30, layoutName: "theatre" }, event);
    const result = assessFlaggedBooking(input({ needs: { ...breakout, requirements: [] }, venue: venue({ layouts: [{ layoutName: "theatre", capacity: 40 }] }) }));

    expect(result.suitability).toEqual({ ok: true, unmet: [] });
  });
});

describe("assessFlaggedBooking - suitability for the event's present requirements (AC4)", () => {
  it("passes a room that still seats the attendance in the layout and has what is required", () => {
    expect(assessFlaggedBooking(input())).toEqual({
      suitability: { ok: true, unmet: [] },
      availability: { ok: true, unmet: [] },
    });
  });

  it("passes a room that seats exactly the expected attendance", () => {
    const result = assessFlaggedBooking(input({ needs: { expectedAttendance: 100, preferredLayout: "theatre", requirements: [] } }));

    expect(result.suitability).toEqual({ ok: true, unmet: [] });
  });

  it("names the capacity when the attendance has outgrown the layout", () => {
    const result = assessFlaggedBooking(input({ needs: { expectedAttendance: 150, preferredLayout: "theatre", requirements: [] } }));

    expect(result.suitability).toEqual({ ok: false, unmet: ["Theatre capacity is 100 - this space expects 150."] });
    expect(result.availability.ok).toBe(true);
  });

  it("names a layout the venue does not offer", () => {
    const result = assessFlaggedBooking(input({ needs: { expectedAttendance: 20, preferredLayout: "boardroom", requirements: [] } }));

    expect(result.suitability).toEqual({ ok: false, unmet: ["Boardroom layout is not offered."] });
  });

  it("names a required facility and a required accessibility feature the venue lacks", () => {
    const result = assessFlaggedBooking(
      input({
        needs: {
          expectedAttendance: 80,
          preferredLayout: "theatre",
          requirements: [
            { facilityId: "f-projector", name: "Fixed ceiling projector", category: "facility", isMandatory: true },
            { facilityId: "f-stage", name: "Raised stage", category: "facility", isMandatory: true },
            { facilityId: "f-loop", name: "Hearing induction loop", category: "accessibility", isMandatory: true },
          ],
        },
      })
    );

    expect(result.suitability).toEqual({
      ok: false,
      unmet: ["Missing facility: Raised stage.", "Missing accessibility feature: Hearing induction loop."],
    });
  });

  it("does not fail a room for a nice-to-have it lacks", () => {
    const result = assessFlaggedBooking(
      input({
        needs: {
          expectedAttendance: 80,
          preferredLayout: "theatre",
          requirements: [{ facilityId: "f-green", name: "Green room", category: "facility", isMandatory: false }],
        },
      })
    );

    expect(result.suitability).toEqual({ ok: true, unmet: [] });
  });
});

describe("assessFlaggedBooking - availability for the event's present time (AC4)", () => {
  it("says a retired venue has been retired", () => {
    const result = assessFlaggedBooking(input({ venue: venue({ isActive: false }) }));

    expect(result.availability).toEqual({ ok: false, unmet: ["Hall has been retired."] });
  });

  it("names the unavailable period that covers the booking", () => {
    const result = assessFlaggedBooking(
      input({ venue: venue({ unavailability: [{ startsAt: at(DAY, 8), endsAt: at(DAY, 18), reason: "maintenance" }] }) })
    );

    expect(result.availability).toEqual({
      ok: false,
      unmet: ["Hall is unavailable at this time (maintenance, 8 Oct 2027, 08:00–18:00)."],
    });
  });

  it("ignores an unavailable period on another day", () => {
    const result = assessFlaggedBooking(
      input({ venue: venue({ unavailability: [{ startsAt: at("2027-10-09", 8), endsAt: at("2027-10-09", 18), reason: "maintenance" }] }) })
    );

    expect(result.availability).toEqual({ ok: true, unmet: [] });
  });

  it("names another event's approved booking of the room at the same time", () => {
    const result = assessFlaggedBooking(
      input({
        venue: venue({
          bookings: [
            {
              id: "b2",
              eventId: "e2",
              status: "approved",
              startsAt: at(DAY, 12),
              endsAt: at(DAY, 14),
              eventReference: "EVT-000050",
              eventTitle: "Other Event",
            },
          ],
        }),
      })
    );

    expect(result.availability).toEqual({
      ok: false,
      unmet: ["Hall is already booked for EVT-000050 Other Event on 8 Oct 2027, 12:00–14:00."],
    });
  });

  it("counts the venue's setup and turnaround, so a booking that ends just before still clashes", () => {
    const result = assessFlaggedBooking(
      input({
        venue: venue({
          setupMinutes: 60,
          bookings: [{ id: "b2", eventId: "e2", status: "approved", startsAt: at(DAY, 7), endsAt: at(DAY, 8, 30) }],
        }),
      })
    );

    expect(result.availability.ok).toBe(false);
  });

  it("never counts the booking against itself, or against the same event's other booking", () => {
    const result = assessFlaggedBooking(
      input({
        venue: venue({
          bookings: [
            { id: "b1", eventId: "e1", status: "approved", startsAt: at(DAY, 9), endsAt: at(DAY, 17) },
            { id: "b3", eventId: "e1", status: "approved", startsAt: at(DAY, 9), endsAt: at(DAY, 17) },
          ],
        }),
      })
    );

    expect(result.availability).toEqual({ ok: true, unmet: [] });
  });

  it("does not let another event's pending request stand in the way of an approved booking", () => {
    const result = assessFlaggedBooking(
      input({ venue: venue({ bookings: [{ id: "b2", eventId: "e2", status: "pending", startsAt: at(DAY, 9), endsAt: at(DAY, 17) }] }) })
    );

    expect(result.availability).toEqual({ ok: true, unmet: [] });
  });

  it("says so when the booking no longer covers the event's time", () => {
    const result = assessFlaggedBooking(
      input({ schedule: { startsAt: at("2027-10-09", 9), endsAt: at("2027-10-09", 17) } })
    );

    expect(result.availability).toEqual({
      ok: false,
      unmet: ["The booking (8 Oct 2027, 09:00–17:00) does not cover the event's time (9 Oct 2027, 09:00–17:00)."],
    });
  });

  it("speaks of the session's time for a session's booking", () => {
    const result = assessFlaggedBooking(
      input({ holder: "session", schedule: { startsAt: at(DAY, 9), endsAt: at(DAY, 18) } })
    );

    expect(result.availability.unmet).toEqual([
      "The booking (8 Oct 2027, 09:00–17:00) does not cover the session's time (8 Oct 2027, 09:00–18:00).",
    ]);
  });

  it("accepts a booking wider than the event's time", () => {
    const result = assessFlaggedBooking(input({ schedule: { startsAt: at(DAY, 10), endsAt: at(DAY, 16) } }));

    expect(result.availability).toEqual({ ok: true, unmet: [] });
  });

  it("reports suitability and availability separately when both fail", () => {
    const result = assessFlaggedBooking(
      input({
        needs: { expectedAttendance: 150, preferredLayout: "theatre", requirements: [] },
        venue: venue({ isActive: false }),
      })
    );

    expect(result.suitability.ok).toBe(false);
    expect(result.availability.ok).toBe(false);
  });
});

describe("assessFlaggedEquipment - availability for the event's present dates and quantities (AC5)", () => {
  it("passes a reservation the available units still cover", () => {
    expect(assessFlaggedEquipment({ status: "reserved", quantityRequested: 2, quantityReserved: 2, available: 4 })).toEqual({
      ok: true,
      needed: 2,
      available: 4,
      summary: "2 reserved, 4 available for these dates.",
    });
  });

  it("passes when exactly the reserved quantity is available", () => {
    expect(assessFlaggedEquipment({ status: "reserved", quantityRequested: 2, quantityReserved: 2, available: 2 }).ok).toBe(true);
  });

  it("fails a reservation left one unit short", () => {
    expect(assessFlaggedEquipment({ status: "reserved", quantityRequested: 2, quantityReserved: 2, available: 1 })).toEqual({
      ok: false,
      needed: 2,
      available: 1,
      summary: "2 reserved, 1 available for these dates.",
    });
  });

  it("judges a partially fulfilled line by what it has reserved, not what was asked for", () => {
    const result = assessFlaggedEquipment({ status: "partially_fulfilled", quantityRequested: 4, quantityReserved: 2, available: 2 });

    expect(result).toMatchObject({ ok: true, needed: 2, summary: "2 reserved, 2 available for these dates." });
  });

  it.each(["requested", "under_review"])("judges a %s line by the quantity requested", (status) => {
    const result = assessFlaggedEquipment({ status, quantityRequested: 4, quantityReserved: null, available: 3 });

    expect(result).toMatchObject({ ok: false, needed: 4, summary: "4 requested, 3 available for these dates." });
  });

  it("cannot pass a line whose event has no dates to check", () => {
    expect(assessFlaggedEquipment({ status: "reserved", quantityRequested: 2, quantityReserved: 2, available: null })).toEqual({
      ok: false,
      needed: 2,
      available: null,
      summary: "Availability could not be checked: this event has no dates yet.",
    });
  });
});

describe("the wording around a flagged arrangement", () => {
  it("names the arrangement and every unmet requirement when Keep is refused (AC7)", () => {
    expect(keepRefusal("SPM68 Hall", ["Theatre capacity is 100 - this space expects 150.", "SPM68 Hall has been retired."])).toBe(
      "SPM68 Hall no longer meets this event's requirements: Theatre capacity is 100 - this space expects 150. SPM68 Hall has been retired."
    );
  });

  it("counts the attendees registered and on the waiting list (AC8)", () => {
    expect(registrationCountLine(12, 3)).toBe("12 registered, 3 on the waiting list");
    expect(registrationCountLine(5, 0)).toBe("5 registered, 0 on the waiting list");
  });
});
