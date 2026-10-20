// SPM-64 Configure Event Registration - the pure rules (written test-first):
//   src/lib/registrationSettings.ts
//     liveBookings(bookings)                        the pending and approved ones
//     measuredBooking(bookings, selectedId, savedId) the booking the capacity is measured against, or the
//                                                   field and message to refuse with
//     capacityError(capacity, booking)              null when allowed, else the message for 'Registration capacity'
//     periodErrors({ opensAt, closesAt }, startsAt)   field -> message for the period, empty when allowed
//     startedError(startsAt, now)                   the refusal once the event has started, else null
//     registrationReviewReasons(before, after, n)   the review reasons a change raises, n = registered + waitlisted
//     registrationFlagLine(n, reasons)              the 'Flagged for review' line
// Manual cases: docs/test-cases/SPM-64_test_cases.json (TC02, TC04, TC06-TC15, TC18-TC22; wording decided there).
import { describe, it, expect } from "vitest";
import {
  capacityError,
  liveBookings,
  measuredBooking,
  periodErrors,
  registrationFlagLine,
  registrationReviewReasons,
  startedError,
  type BookingForCapacity,
} from "../registrationSettings";

/// Orchard Seminar Room as seeded: 120 as a theatre (its maximum), 70 as a classroom.
function booking(overrides: Partial<BookingForCapacity> = {}): BookingForCapacity {
  return {
    id: "seminar",
    status: "approved",
    layoutName: "classroom",
    venue: {
      name: "Orchard Seminar Room",
      code: "ORC-SEM",
      layouts: [
        { layoutName: "theatre", capacity: 120 },
        { layoutName: "classroom", capacity: 70 },
      ],
    },
    ...overrides,
  };
}

const studio = () =>
  booking({
    id: "studio",
    status: "pending",
    venue: { name: "Orchard Studio", code: "ORC-STU", layouts: [{ layoutName: "classroom", capacity: 40 }] },
  });

const CHOOSE = { ok: false, field: "registrationVenueBookingId", error: "Choose which venue booking the capacity is measured against." };
const NOT_ACTIVE = { ok: false, field: "registrationVenueBookingId", error: "That venue booking isn't an active booking for this event." };

describe("liveBookings", () => {
  it("[SPM-64][AC4] keeps pending and approved bookings, and drops rejected and cancelled ones", () => {
    const rows = ["pending", "approved", "rejected", "cancelled"].map((status) => booking({ id: status, status }));

    expect(liveBookings(rows).map((b) => b.id)).toEqual(["pending", "approved"]);
  });
});

describe("AC4 the booking the capacity is measured against", () => {
  it("[SPM-64][AC4] uses the event's only active booking without asking (TC04)", () => {
    expect(measuredBooking([booking(), booking({ id: "old", status: "rejected" })], undefined, null)).toEqual({
      ok: true,
      booking: booking(),
    });
  });

  it("[SPM-64][AC4] asks which booking when there are several and none is chosen (TC10)", () => {
    expect(measuredBooking([booking(), studio()], undefined, null)).toEqual(CHOOSE);
  });

  it("[SPM-64][AC4] uses the booking chosen from several (TC09)", () => {
    expect(measuredBooking([booking(), studio()], "studio", null)).toEqual({ ok: true, booking: studio() });
  });

  it("[SPM-64][AC4] keeps using the booking chosen before while it is still active", () => {
    expect(measuredBooking([booking(), studio()], undefined, "studio")).toEqual({ ok: true, booking: studio() });
  });

  it("[SPM-64][AC4] asks again when the booking chosen before is no longer active and several remain (TC18)", () => {
    const lost = booking({ id: "lost", status: "rejected" });

    expect(measuredBooking([booking(), studio(), lost], undefined, "lost")).toEqual(CHOOSE);
  });

  it("[SPM-64][AC4] moves to the only remaining active booking when the one chosen before is lost (TC18)", () => {
    const lost = booking({ id: "lost", status: "rejected" });

    expect(measuredBooking([studio(), lost], undefined, "lost")).toEqual({ ok: true, booking: studio() });
  });

  it.each(["rejected", "cancelled"])("[SPM-64][AC4] refuses a chosen booking that is %s", (status) => {
    expect(measuredBooking([booking(), studio(), booking({ id: "gone", status })], "gone", null)).toEqual(NOT_ACTIVE);
  });

  it("[SPM-64][AC4] refuses a chosen booking that isn't one of this event's", () => {
    expect(measuredBooking([booking(), studio()], "another-events-booking", null)).toEqual(NOT_ACTIVE);
  });

  it("[SPM-64][AC4] refuses a capacity when the event has no active booking (TC07)", () => {
    expect(measuredBooking([booking({ status: "cancelled" })], undefined, null)).toEqual({
      ok: false,
      field: "registrationCapacity",
      error: "Book a venue for this event before setting a registration capacity.",
    });
  });
});

// The event starts 17 Mar 2027, 09:00 Singapore time.
const START = new Date("2027-03-17T01:00:00.000Z");
const at = (iso: string) => new Date(iso);

describe("AC5 the registration period is separate from the event date", () => {
  it("[SPM-64][AC5] accepts a period that opens and closes before the event (TC11)", () => {
    expect(
      periodErrors({ opensAt: at("2027-02-01T01:00:00.000Z"), closesAt: at("2027-03-10T09:00:00.000Z") }, START)
    ).toEqual({});
  });

  it("[SPM-64][AC5] accepts an opening date or a closing date on its own", () => {
    expect(periodErrors({ opensAt: at("2027-02-01T01:00:00.000Z"), closesAt: null }, START)).toEqual({});
    expect(periodErrors({ opensAt: null, closesAt: at("2027-03-10T09:00:00.000Z") }, START)).toEqual({});
  });

  it("[SPM-64][AC5] skips the start check for an event with no start yet", () => {
    expect(periodErrors({ opensAt: null, closesAt: at("2028-01-01T01:00:00.000Z") }, null)).toEqual({});
  });
});

describe("AC6 the closing date is not earlier than the opening date or later than the event's start", () => {
  const CLOSES_BEFORE_OPENS = { registrationClosesAt: "Registration closes at must be after it opens." };
  const CLOSES_AFTER_START = { registrationClosesAt: "Registration must close no later than the event starts." };

  it("[SPM-64][AC6] refuses closing before opening (TC12)", () => {
    expect(
      periodErrors({ opensAt: at("2027-03-01T01:00:00.000Z"), closesAt: at("2027-02-01T01:00:00.000Z") }, START)
    ).toEqual(CLOSES_BEFORE_OPENS);
  });

  it("[SPM-64][AC6] refuses closing at the same moment as opening (TC12)", () => {
    expect(
      periodErrors({ opensAt: at("2027-03-01T01:00:00.000Z"), closesAt: at("2027-03-01T01:00:00.000Z") }, START)
    ).toEqual(CLOSES_BEFORE_OPENS);
  });

  it("[SPM-64][AC6] allows closing exactly when the event starts (TC13)", () => {
    expect(periodErrors({ opensAt: at("2027-02-01T01:00:00.000Z"), closesAt: START }, START)).toEqual({});
  });

  it("[SPM-64][AC6] refuses closing a minute after the event starts (TC13)", () => {
    expect(
      periodErrors({ opensAt: at("2027-02-01T01:00:00.000Z"), closesAt: at("2027-03-17T01:01:00.000Z") }, START)
    ).toEqual(CLOSES_AFTER_START);
  });
});

describe("AC7 the period can be extended or reopened until the event starts", () => {
  const STARTED = "The event has started, so the registration period can't be changed.";

  it("[SPM-64][AC7] allows a change before the event starts, even once the old closing date has passed (TC14)", () => {
    expect(startedError(START, at("2027-03-17T00:59:00.000Z"))).toBeNull();
  });

  it("[SPM-64][AC7] refuses a change from the moment the event starts (TC15)", () => {
    expect(startedError(START, START)).toBe(STARTED);
  });

  it("[SPM-64][AC7] refuses a change after the event has started (TC15)", () => {
    expect(startedError(START, at("2027-03-17T05:00:00.000Z"))).toBe(STARTED);
  });

  it("[SPM-64][AC7] never refuses for an event with no start yet", () => {
    expect(startedError(null, START)).toBeNull();
  });
});

describe("AC9 a change that leaves attendees without a place flags the registrations", () => {
  const on = (capacity: number | null) => ({ enabled: true, capacity });
  const off = (capacity: number | null) => ({ enabled: false, capacity });

  it("[SPM-64][AC9] flags a capacity lowered below the attendees holding a place (TC19)", () => {
    expect(registrationReviewReasons(on(20), on(14), 15)).toEqual(["registration_capacity_lowered"]);
  });

  it("[SPM-64][AC9] flags nothing when the capacity is lowered to exactly that number (TC20)", () => {
    expect(registrationReviewReasons(on(20), on(15), 15)).toEqual([]);
  });

  it("[SPM-64][AC9] flags a first capacity that is already below the attendees holding a place", () => {
    expect(registrationReviewReasons(on(null), on(10), 15)).toEqual(["registration_capacity_lowered"]);
  });

  it("[SPM-64][AC9] flags nothing when the capacity is unchanged, even if already below the number", () => {
    expect(registrationReviewReasons(on(10), on(10), 15)).toEqual([]);
  });

  it("[SPM-64][AC9] flags registration turned off while anyone holds a place (TC21)", () => {
    expect(registrationReviewReasons(on(10), off(10), 4)).toEqual(["registration_disabled"]);
  });

  it("[SPM-64][AC9] flags nothing when registration is turned off with nobody holding a place (TC02)", () => {
    expect(registrationReviewReasons(on(50), off(50), 0)).toEqual([]);
  });

  it("[SPM-64][AC9] gives both reasons when the capacity is lowered and registration turned off together", () => {
    expect(registrationReviewReasons(on(20), off(14), 15)).toEqual([
      "registration_capacity_lowered",
      "registration_disabled",
    ]);
  });

  it("[SPM-64][AC9] words the flag line for the person who saved (TC19, TC21, TC22)", () => {
    expect(registrationFlagLine(15, ["registration_capacity_lowered"])).toBe(
      "Registrations: 15 attendees – the registration capacity was lowered below the number registered or waitlisted"
    );
    expect(registrationFlagLine(1, ["registration_disabled"])).toBe(
      "Registrations: 1 attendee – registration was turned off"
    );
  });
});

describe("AC3 the capacity cannot exceed the booked room's capacity for its layout", () => {
  it("[SPM-64][AC3] allows exactly the layout's capacity (TC06)", () => {
    expect(capacityError(70, booking())).toBeNull();
  });

  it("[SPM-64][AC3] refuses one over, naming the room and layout, and never falls back to the room's maximum (TC06)", () => {
    expect(capacityError(71, booking())).toBe(
      "Registration capacity can't be more than 70, the capacity of Orchard Seminar Room (ORC-SEM) in its Classroom layout."
    );
  });

  it("[SPM-64][AC3] measures against the chosen booking's own room (TC09)", () => {
    expect(capacityError(41, studio())).toBe(
      "Registration capacity can't be more than 40, the capacity of Orchard Studio (ORC-STU) in its Classroom layout."
    );
  });

  it.each([
    ["has no layout", { layoutName: null }],
    ["has a layout the room no longer offers", { layoutName: "banquet" }],
  ])("[SPM-64][AC3] refuses a capacity when the booking %s (TC08)", (_why, overrides) => {
    expect(capacityError(30, booking(overrides))).toBe(
      "The venue booking has no room layout, so its capacity isn't known. Book the venue with a room layout first."
    );
  });
});
