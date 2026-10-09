// SPM-64 Configure Event Registration - the pure rules (written test-first):
//   src/lib/registrationSettings.ts
//     liveBookings(bookings)            the pending and approved ones
//     capacityError(capacity, live)     null when allowed, else the message shown under 'Registration capacity'
// Manual cases: docs/test-cases/SPM-64_test_cases.json (TC06-TC08; wording decided there).
import { describe, it, expect } from "vitest";
import { capacityError, liveBookings, type BookingForCapacity } from "../registrationSettings";

/// Orchard Seminar Room as seeded: 120 as a theatre (its maximum), 70 as a classroom.
function booking(overrides: Partial<BookingForCapacity> = {}): BookingForCapacity {
  return {
    id: "booking-1",
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

describe("liveBookings", () => {
  it("keeps pending and approved bookings, and drops rejected and cancelled ones", () => {
    const rows = ["pending", "approved", "rejected", "cancelled"].map((status) => booking({ id: status, status }));

    expect(liveBookings(rows).map((b) => b.id)).toEqual(["pending", "approved"]);
  });
});

describe("AC3 the capacity cannot exceed the booked room's capacity for its layout", () => {
  it("allows exactly the layout's capacity (TC06)", () => {
    expect(capacityError(70, [booking()])).toBeNull();
  });

  it("refuses one over, naming the room and layout, and never falls back to the room's maximum (TC06)", () => {
    expect(capacityError(71, [booking()])).toBe(
      "Registration capacity can't be more than 70, the capacity of Orchard Seminar Room (ORC-SEM) in its Classroom layout."
    );
  });

  it("measures against a pending booking too", () => {
    expect(capacityError(70, [booking({ status: "pending" })])).toBeNull();
  });

  it("refuses a capacity when the event has no booking (TC07)", () => {
    expect(capacityError(30, [])).toBe("Book a venue for this event before setting a registration capacity.");
  });

  it.each([
    ["has no layout", { layoutName: null }],
    ["has a layout the room no longer offers", { layoutName: "banquet" }],
  ])("refuses a capacity when the booking %s (TC08)", (_why, overrides) => {
    expect(capacityError(30, [booking(overrides)])).toBe(
      "The venue booking has no room layout, so its capacity isn't known. Book the venue with a room layout first."
    );
  });
});
