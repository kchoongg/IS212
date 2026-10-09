// SPM-64 Configure Event Registration - the pure rules (written test-first):
//   src/lib/registrationSettings.ts
//     liveBookings(bookings)                        the pending and approved ones
//     measuredBooking(bookings, selectedId, savedId) the booking the capacity is measured against, or the
//                                                   field and message to refuse with
//     capacityError(capacity, booking)              null when allowed, else the message for 'Registration capacity'
//     periodErrors({ opensAt, closesAt }, startsAt)   field -> message for the period, empty when allowed
// Manual cases: docs/test-cases/SPM-64_test_cases.json (TC04, TC06-TC13, TC18; wording decided there).
import { describe, it, expect } from "vitest";
import { capacityError, liveBookings, measuredBooking, periodErrors, type BookingForCapacity } from "../registrationSettings";

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
  it("keeps pending and approved bookings, and drops rejected and cancelled ones", () => {
    const rows = ["pending", "approved", "rejected", "cancelled"].map((status) => booking({ id: status, status }));

    expect(liveBookings(rows).map((b) => b.id)).toEqual(["pending", "approved"]);
  });
});

describe("AC4 the booking the capacity is measured against", () => {
  it("uses the event's only active booking without asking (TC04)", () => {
    expect(measuredBooking([booking(), booking({ id: "old", status: "rejected" })], undefined, null)).toEqual({
      ok: true,
      booking: booking(),
    });
  });

  it("asks which booking when there are several and none is chosen (TC10)", () => {
    expect(measuredBooking([booking(), studio()], undefined, null)).toEqual(CHOOSE);
  });

  it("uses the booking chosen from several (TC09)", () => {
    expect(measuredBooking([booking(), studio()], "studio", null)).toEqual({ ok: true, booking: studio() });
  });

  it("keeps using the booking chosen before while it is still active", () => {
    expect(measuredBooking([booking(), studio()], undefined, "studio")).toEqual({ ok: true, booking: studio() });
  });

  it("asks again when the booking chosen before is no longer active and several remain (TC18)", () => {
    const lost = booking({ id: "lost", status: "rejected" });

    expect(measuredBooking([booking(), studio(), lost], undefined, "lost")).toEqual(CHOOSE);
  });

  it("moves to the only remaining active booking when the one chosen before is lost (TC18)", () => {
    const lost = booking({ id: "lost", status: "rejected" });

    expect(measuredBooking([studio(), lost], undefined, "lost")).toEqual({ ok: true, booking: studio() });
  });

  it.each(["rejected", "cancelled"])("refuses a chosen booking that is %s", (status) => {
    expect(measuredBooking([booking(), studio(), booking({ id: "gone", status })], "gone", null)).toEqual(NOT_ACTIVE);
  });

  it("refuses a chosen booking that isn't one of this event's", () => {
    expect(measuredBooking([booking(), studio()], "another-events-booking", null)).toEqual(NOT_ACTIVE);
  });

  it("refuses a capacity when the event has no active booking (TC07)", () => {
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
  it("accepts a period that opens and closes before the event (TC11)", () => {
    expect(
      periodErrors({ opensAt: at("2027-02-01T01:00:00.000Z"), closesAt: at("2027-03-10T09:00:00.000Z") }, START)
    ).toEqual({});
  });

  it("accepts an opening date or a closing date on its own", () => {
    expect(periodErrors({ opensAt: at("2027-02-01T01:00:00.000Z"), closesAt: null }, START)).toEqual({});
    expect(periodErrors({ opensAt: null, closesAt: at("2027-03-10T09:00:00.000Z") }, START)).toEqual({});
  });

  it("skips the start check for an event with no start yet", () => {
    expect(periodErrors({ opensAt: null, closesAt: at("2028-01-01T01:00:00.000Z") }, null)).toEqual({});
  });
});

describe("AC6 the closing date is not earlier than the opening date or later than the event's start", () => {
  const CLOSES_BEFORE_OPENS = { registrationClosesAt: "Registration closes at must be after it opens." };
  const CLOSES_AFTER_START = { registrationClosesAt: "Registration must close no later than the event starts." };

  it("refuses closing before opening (TC12)", () => {
    expect(
      periodErrors({ opensAt: at("2027-03-01T01:00:00.000Z"), closesAt: at("2027-02-01T01:00:00.000Z") }, START)
    ).toEqual(CLOSES_BEFORE_OPENS);
  });

  it("refuses closing at the same moment as opening (TC12)", () => {
    expect(
      periodErrors({ opensAt: at("2027-03-01T01:00:00.000Z"), closesAt: at("2027-03-01T01:00:00.000Z") }, START)
    ).toEqual(CLOSES_BEFORE_OPENS);
  });

  it("allows closing exactly when the event starts (TC13)", () => {
    expect(periodErrors({ opensAt: at("2027-02-01T01:00:00.000Z"), closesAt: START }, START)).toEqual({});
  });

  it("refuses closing a minute after the event starts (TC13)", () => {
    expect(
      periodErrors({ opensAt: at("2027-02-01T01:00:00.000Z"), closesAt: at("2027-03-17T01:01:00.000Z") }, START)
    ).toEqual(CLOSES_AFTER_START);
  });
});

describe("AC3 the capacity cannot exceed the booked room's capacity for its layout", () => {
  it("allows exactly the layout's capacity (TC06)", () => {
    expect(capacityError(70, booking())).toBeNull();
  });

  it("refuses one over, naming the room and layout, and never falls back to the room's maximum (TC06)", () => {
    expect(capacityError(71, booking())).toBe(
      "Registration capacity can't be more than 70, the capacity of Orchard Seminar Room (ORC-SEM) in its Classroom layout."
    );
  });

  it("measures against the chosen booking's own room (TC09)", () => {
    expect(capacityError(41, studio())).toBe(
      "Registration capacity can't be more than 40, the capacity of Orchard Studio (ORC-STU) in its Classroom layout."
    );
  });

  it.each([
    ["has no layout", { layoutName: null }],
    ["has a layout the room no longer offers", { layoutName: "banquet" }],
  ])("refuses a capacity when the booking %s (TC08)", (_why, overrides) => {
    expect(capacityError(30, booking(overrides))).toBe(
      "The venue booking has no room layout, so its capacity isn't known. Book the venue with a room layout first."
    );
  });
});
