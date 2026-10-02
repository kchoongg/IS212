import { describe, it, expect } from "vitest";
import {
  checkVenueBookingApproval,
  describeVenueConflict,
  findVenueConflict,
} from "../venueConflict";
import type { SearchBooking, SearchableVenue } from "../venueSearch";

// Booking Conflict Detection (SPM-44).
//
// Times are Singapore local (#36). The slots are AM 07:00-12:00,
// PM 13:00-18:00, Night 19:00-24:00 (#50), and a slot touched at all is taken
// in full (#107).

/** A Singapore wall-clock time as the Date the app would store. */
const sgt = (day: string, hour: number) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00+08:00`);

const AM = (day: string) => ({ startsAt: sgt(day, 9), endsAt: sgt(day, 11) });
const PM = (day: string) => ({ startsAt: sgt(day, 14), endsAt: sgt(day, 16) });
const NIGHT = (day: string) => ({ startsAt: sgt(day, 20), endsAt: sgt(day, 22) });

function venue(over: Partial<SearchableVenue> = {}): SearchableVenue {
  return {
    name: "Marina Auditorium",
    building: "Marina Centre",
    opensAt: "07:00",
    closesAt: "24:00",
    setupMinutes: 0,
    teardownMinutes: 0,
    layouts: [{ layoutName: "theatre", capacity: 200 }],
    facilityIds: [],
    bookings: [],
    unavailability: [],
    ...over,
  };
}

function booking(over: Partial<SearchBooking> & { startsAt: Date; endsAt: Date }): SearchBooking {
  return {
    eventId: "other-event",
    status: "approved",
    eventReference: "EVT-000042",
    eventTitle: "Product Showcase",
    ...over,
  };
}

describe("findVenueConflict — what blocks a window", () => {
  // AC3
  it("detects an overlapping approved booking", () => {
    const v = venue({ bookings: [booking({ ...AM("2026-10-21") })] });
    const conflict = findVenueConflict(v, AM("2026-10-21"));
    expect(conflict?.kind).toBe("booked");
    expect(conflict?.booking?.eventReference).toBe("EVT-000042");
  });

  // AC4
  it("detects an overlapping pending request", () => {
    const v = venue({ bookings: [booking({ ...PM("2026-10-21"), status: "pending" })] });
    expect(findVenueConflict(v, PM("2026-10-21"))?.kind).toBe("on_hold");
  });

  // AC8
  it("treats recorded unavailability as a conflict", () => {
    const v = venue({
      unavailability: [{ startsAt: sgt("2026-11-20", 0), endsAt: sgt("2026-11-22", 0), reason: "maintenance" }],
    });
    const conflict = findVenueConflict(v, AM("2026-11-20"));
    expect(conflict?.kind).toBe("unavailable");
    expect(conflict?.block?.reason).toBe("maintenance");
  });

  // AC10
  it("allows a booking in a different slot on the same day", () => {
    const v = venue({ bookings: [booking({ ...AM("2026-10-21") })] });
    expect(findVenueConflict(v, PM("2026-10-21"))).toBeNull();
  });

  // AC2 — the exception to the rule above.
  it("blocks a different slot when the venue's setup reaches into it", () => {
    // A venue that needs preparation: the PM booking's setup takes the whole
    // AM slot, so an AM request now clashes with it.
    const v = venue({
      setupMinutes: 60,
      teardownMinutes: 30,
      bookings: [booking({ ...PM("2026-10-21") })],
    });
    expect(findVenueConflict(v, AM("2026-10-21"))?.kind).toBe("booked");
  });

  it("blocks across midnight: a Night booking's turnaround takes the next day's AM", () => {
    const v = venue({
      setupMinutes: 60,
      teardownMinutes: 60,
      bookings: [booking({ ...NIGHT("2026-10-21") })],
    });
    expect(findVenueConflict(v, AM("2026-10-22"))?.kind).toBe("booked");
  });

  // AC7 — "withdrawn" and "released" are both stored as cancelled.
  it.each(["rejected", "cancelled"])("ignores a %s booking entirely", (status) => {
    const v = venue({ bookings: [booking({ ...AM("2026-10-21"), status })] });
    expect(findVenueConflict(v, AM("2026-10-21"))).toBeNull();
  });

  it("never conflicts with the event's own booking", () => {
    const v = venue({ bookings: [booking({ ...AM("2026-10-21"), eventId: "mine" })] });
    expect(findVenueConflict(v, AM("2026-10-21"), { eventId: "mine" })).toBeNull();
  });

  it("reports unavailability before a booking, because moving an event cannot free a closed room", () => {
    const v = venue({
      bookings: [booking({ ...AM("2026-10-21") })],
      unavailability: [{ startsAt: sgt("2026-10-21", 0), endsAt: sgt("2026-10-22", 0), reason: "renovation" }],
    });
    expect(findVenueConflict(v, AM("2026-10-21"))?.kind).toBe("unavailable");
  });

  // The overlap test is half-open everywhere in the venues domain
  // (SCHEMA_REFERENCE.md): each must start before the other ends. If this ever
  // becomes <=, every back-to-back booking in the system starts failing.
  //
  // The boundary is at a SLOT edge, not at a minute: a slot touched at all is
  // consumed in full (#107), so a block from 07:00 to 09:00 takes the whole of
  // AM even though it ends before an 09:00 request begins. What must not clash
  // is a block that fills AM exactly, against a request in PM.
  it("does not treat a period ending exactly at a slot edge as a clash with the next slot", () => {
    const v = venue({
      unavailability: [
        // 07:00-12:00 - the whole of AM, ending exactly where AM ends.
        { startsAt: sgt("2026-10-21", 7), endsAt: sgt("2026-10-21", 12), reason: "maintenance" },
      ],
    });
    expect(findVenueConflict(v, PM("2026-10-21"))).toBeNull();
    // ...and the same block still blocks AM itself.
    expect(findVenueConflict(v, AM("2026-10-21"))?.kind).toBe("unavailable");
  });

  // 12:00-13:00, 18:00-19:00 and 00:00-07:00 belong to no slot (#50). A
  // booking living entirely inside one touches nothing, so it can block
  // nothing - and, just as important, naming it must not throw.
  it("ignores a booking that falls entirely in the gap between two slots", () => {
    const v = venue({
      bookings: [booking({ startsAt: sgt("2026-10-21", 12), endsAt: sgt("2026-10-21", 13) })],
    });
    expect(findVenueConflict(v, AM("2026-10-21"))).toBeNull();
    expect(findVenueConflict(v, PM("2026-10-21"))).toBeNull();
  });

  it("reports only the cells the two parties actually share", () => {
    const v = venue({ bookings: [booking({ ...PM("2026-10-21") })] });
    // The request runs AM through PM; only PM is contested.
    const conflict = findVenueConflict(v, { startsAt: sgt("2026-10-21", 9), endsAt: sgt("2026-10-21", 16) });
    expect(conflict?.cells).toEqual([{ day: "2026-10-21", slot: "PM" }]);
  });
});

describe("findVenueConflict — confirm time (AC6)", () => {
  it("blocks confirming over an existing approved booking", () => {
    const v = venue({ bookings: [booking({ ...AM("2026-10-21") })] });
    expect(findVenueConflict(v, AM("2026-10-21"), { scope: "approved" })?.kind).toBe("booked");
  });

  // The difference that matters: at request time a pending sibling blocks, at
  // confirm time it must not - approving one request is how Venue Staff pick
  // between two, so a rival hold cannot be allowed to veto the decision.
  it("does NOT block confirming merely because another request is pending", () => {
    const v = venue({ bookings: [booking({ ...AM("2026-10-21"), status: "pending" })] });
    expect(findVenueConflict(v, AM("2026-10-21"), { scope: "active" })?.kind).toBe("on_hold");
    expect(findVenueConflict(v, AM("2026-10-21"), { scope: "approved" })).toBeNull();
  });

  it("does not let a booking conflict with itself", () => {
    const mine = booking({ ...AM("2026-10-21"), id: "booking-1", eventId: "mine" });
    const v = venue({ bookings: [mine] });
    expect(checkVenueBookingApproval({ venue: v, booking: mine })).toEqual({ ok: true });
  });

  it("refuses approval when another event's booking was approved first", () => {
    const rival = booking({ ...AM("2026-10-21"), id: "booking-rival" });
    const mine = booking({ ...AM("2026-10-21"), id: "booking-mine", eventId: "mine", status: "pending" });
    const v = venue({ bookings: [rival, mine] });

    const result = checkVenueBookingApproval({ venue: v, booking: mine });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict.kind).toBe("booked");
      expect(result.error).toContain("EVT-000042 Product Showcase");
    }
  });

  it("refuses approval when the room has since been blocked", () => {
    const mine = booking({ ...AM("2026-11-20"), id: "booking-mine", status: "pending" });
    const v = venue({
      bookings: [mine],
      unavailability: [{ startsAt: sgt("2026-11-20", 0), endsAt: sgt("2026-11-21", 0), reason: "maintenance" }],
    });
    const result = checkVenueBookingApproval({ venue: v, booking: mine });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("unavailable");
  });
});

describe("describeVenueConflict — AC9, naming what is in the way", () => {
  it("names the event, and the day and slots it holds", () => {
    const v = venue({ bookings: [booking({ ...AM("2026-10-21") })] });
    const conflict = findVenueConflict(v, AM("2026-10-21"))!;
    expect(describeVenueConflict(v.name, conflict)).toBe(
      "Marina Auditorium is already booked for EVT-000042 Product Showcase on 21 Oct 2026, AM."
    );
  });

  it("spans the slots when more than one is contested", () => {
    const v = venue({
      bookings: [booking({ startsAt: sgt("2026-10-21", 9), endsAt: sgt("2026-10-21", 16) })],
    });
    const conflict = findVenueConflict(v, { startsAt: sgt("2026-10-21", 9), endsAt: sgt("2026-10-21", 16) })!;
    expect(describeVenueConflict(v.name, conflict)).toContain("21 Oct 2026, AM–PM");
  });

  it("names a pending hold as a hold, not a booking", () => {
    const v = venue({ bookings: [booking({ ...PM("2026-10-21"), status: "pending" })] });
    const conflict = findVenueConflict(v, PM("2026-10-21"))!;
    expect(describeVenueConflict(v.name, conflict)).toBe(
      "Marina Auditorium is on hold for EVT-000042 Product Showcase on 21 Oct 2026, PM."
    );
  });

  it("gives the reason and the period for an unavailable room", () => {
    const v = venue({
      unavailability: [{ startsAt: sgt("2026-11-20", 0), endsAt: sgt("2026-11-22", 0), reason: "maintenance" }],
    });
    const conflict = findVenueConflict(v, AM("2026-11-20"))!;
    expect(describeVenueConflict(v.name, conflict)).toBe(
      "Marina Auditorium is unavailable at this time (maintenance, 20 Nov 2026 AM – 21 Nov 2026 Night)."
    );
  });

  // The search screen loads no event labels, so the message must still work.
  it("falls back to the period when the event cannot be named", () => {
    const v = venue({
      bookings: [{ ...AM("2026-10-21"), eventId: "other", status: "approved" }],
    });
    const conflict = findVenueConflict(v, AM("2026-10-21"))!;
    expect(describeVenueConflict(v.name, conflict)).toBe(
      "Marina Auditorium is already booked on 21 Oct 2026, AM."
    );
  });
});
