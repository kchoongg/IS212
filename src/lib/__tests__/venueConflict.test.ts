import { describe, it, expect } from "vitest";
import {
  describeVenueConflict,
  findDuplicateRequest,
  findVenueConflict,
} from "../venueConflict";
import type { SearchBooking, SearchableVenue } from "../venueSearch";

// Booking Conflict Detection (SPM-44), with SPM-93's rule: no slots - a booking
// occupies the room from its start minus the venue's setup to its end plus its
// turnaround (Week 7 Customer Changes, Change #1), and two bookings clash when
// those periods overlap. Times are Singapore local (#36).

/** A Singapore wall-clock time as the Date the app would store. */
const sgt = (day: string, clock: string) => new Date(`${day}T${clock}:00+08:00`);
const at = (day: string, from: string, to: string) => ({ startsAt: sgt(day, from), endsAt: sgt(day, to) });

const MORNING = (day: string) => at(day, "09:00", "11:00");
const AFTERNOON = (day: string) => at(day, "14:00", "16:00");

function venue(over: Partial<SearchableVenue> = {}): SearchableVenue {
  return {
    name: "Marina Auditorium",
    building: "Marina Centre",
    opensAt: "07:00",
    closesAt: "23:59",
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
    const v = venue({ bookings: [booking({ ...MORNING("2026-10-21") })] });
    const conflict = findVenueConflict(v, MORNING("2026-10-21"));
    expect(conflict?.kind).toBe("booked");
    expect(conflict?.booking?.eventReference).toBe("EVT-000042");
  });

  // AC4
  it("detects an overlapping pending request", () => {
    const v = venue({ bookings: [booking({ ...AFTERNOON("2026-10-21"), status: "pending" })] });
    expect(findVenueConflict(v, AFTERNOON("2026-10-21"))?.kind).toBe("on_hold");
  });

  // AC8
  it("treats recorded unavailability as a conflict", () => {
    const v = venue({
      unavailability: [{ startsAt: sgt("2026-11-20", "00:00"), endsAt: sgt("2026-11-22", "00:00"), reason: "maintenance" }],
    });
    const conflict = findVenueConflict(v, MORNING("2026-11-20"));
    expect(conflict?.kind).toBe("unavailable");
    expect(conflict?.block?.reason).toBe("maintenance");
  });

  // AC10
  it("allows a booking at another time on the same day", () => {
    const v = venue({ bookings: [booking({ ...MORNING("2026-10-21") })] });
    expect(findVenueConflict(v, AFTERNOON("2026-10-21"))).toBeNull();
  });

  it("SPM-93: no longer takes a whole slot - a booking 15 minutes away does not clash", () => {
    const v = venue({ bookings: [booking({ ...at("2026-10-21", "11:00", "11:45") })] });
    expect(findVenueConflict(v, at("2026-10-21", "08:00", "09:00"))).toBeNull();
    expect(findVenueConflict(v, at("2026-10-21", "12:00", "13:00"))).toBeNull();
  });

  // AC2 — setup and turnaround, now in minutes (SPM-93 AC6).
  it("SPM-93-TC10: blocks a request whose setup runs into an approved booking's turnaround", () => {
    // Masterclass 10:00-12:00, in use 09:30-12:45.
    const v = venue({ setupMinutes: 30, teardownMinutes: 45, bookings: [booking({ ...at("2027-06-08", "10:00", "12:00") })] });
    expect(findVenueConflict(v, at("2027-06-08", "13:00", "14:00"))?.kind).toBe("booked");
    expect(findVenueConflict(v, at("2027-06-08", "13:15", "14:00"))).toBeNull();
  });

  it("SPM-93-TC09: blocks a request whose turnaround runs into an approved booking's setup", () => {
    const v = venue({ setupMinutes: 30, teardownMinutes: 45, bookings: [booking({ ...at("2027-06-08", "10:00", "12:00") })] });
    expect(findVenueConflict(v, at("2027-06-08", "08:15", "09:00"))?.kind).toBe("booked");
    expect(findVenueConflict(v, at("2027-06-08", "08:15", "08:45"))).toBeNull();
  });

  it("blocks across midnight when turnaround runs past it", () => {
    const v = venue({ teardownMinutes: 60, bookings: [booking({ startsAt: sgt("2026-10-21", "22:00"), endsAt: sgt("2026-10-21", "23:30") })] });
    expect(findVenueConflict(v, { startsAt: sgt("2026-10-22", "00:15"), endsAt: sgt("2026-10-22", "01:00") })?.kind).toBe("booked");
    expect(findVenueConflict(v, { startsAt: sgt("2026-10-22", "00:30"), endsAt: sgt("2026-10-22", "01:00") })).toBeNull();
  });

  it("SPM-93-TC11: a pending request holds its setup and turnaround too", () => {
    // Partner Lunch pending 12:00-13:00, held 11:30-13:45.
    const v = venue({
      setupMinutes: 30,
      teardownMinutes: 45,
      bookings: [booking({ ...at("2027-06-10", "12:00", "13:00"), status: "pending" })],
    });
    expect(findVenueConflict(v, at("2027-06-10", "14:00", "15:00"))?.kind).toBe("on_hold");
    expect(findVenueConflict(v, at("2027-06-10", "14:15", "15:00"))).toBeNull();
  });

  it("SPM-93-TC12: blocks a request whose setup runs into an unavailable period", () => {
    const v = venue({
      setupMinutes: 30,
      teardownMinutes: 45,
      unavailability: [{ ...at("2027-06-16", "14:00", "18:00"), reason: "maintenance" }],
    });
    expect(findVenueConflict(v, at("2027-06-16", "18:15", "20:00"))?.kind).toBe("unavailable");
    expect(findVenueConflict(v, at("2027-06-16", "18:30", "20:00"))).toBeNull();
  });

  // AC7 — "withdrawn" and "released" are both stored as cancelled.
  it.each(["rejected", "cancelled"])("ignores a %s booking entirely", (status) => {
    const v = venue({ bookings: [booking({ ...MORNING("2026-10-21"), status })] });
    expect(findVenueConflict(v, MORNING("2026-10-21"))).toBeNull();
  });

  it("never conflicts with the event's own booking", () => {
    const v = venue({ bookings: [booking({ ...MORNING("2026-10-21"), eventId: "mine" })] });
    expect(findVenueConflict(v, MORNING("2026-10-21"), { eventId: "mine" })).toBeNull();
  });

  it("reports unavailability before a booking, because moving an event cannot free a closed room", () => {
    const v = venue({
      bookings: [booking({ ...MORNING("2026-10-21") })],
      unavailability: [{ startsAt: sgt("2026-10-21", "00:00"), endsAt: sgt("2026-10-22", "00:00"), reason: "renovation" }],
    });
    expect(findVenueConflict(v, MORNING("2026-10-21"))?.kind).toBe("unavailable");
  });

  it("reports an approved booking before a pending one", () => {
    const v = venue({
      bookings: [booking({ ...MORNING("2026-10-21"), status: "pending", id: "held" }), booking({ ...MORNING("2026-10-21"), id: "booked" })],
    });
    expect(findVenueConflict(v, MORNING("2026-10-21"))?.booking?.id).toBe("booked");
  });

  // The overlap test is half-open everywhere in the venues domain
  // (SCHEMA_REFERENCE.md): each must start before the other ends. If this ever
  // becomes <=, every back-to-back booking in the system starts failing.
  it("does not treat a period ending exactly when the request starts as a clash", () => {
    const v = venue({ unavailability: [{ ...at("2026-10-21", "07:00", "09:00"), reason: "maintenance" }] });
    expect(findVenueConflict(v, MORNING("2026-10-21"))).toBeNull();
    expect(findVenueConflict(v, at("2026-10-21", "08:45", "10:00"))?.kind).toBe("unavailable");
  });

  it("SPM-93-TC05: a booking in the old lunch gap blocks like any other (#126)", () => {
    const v = venue({ bookings: [booking({ ...at("2026-10-21", "12:00", "13:00") })] });
    expect(findVenueConflict(v, at("2026-10-21", "12:30", "13:30"))?.kind).toBe("booked");
  });

  it("reports only the time the two parties actually share", () => {
    const v = venue({ bookings: [booking({ ...AFTERNOON("2026-10-21") })] });
    // The request runs 09:00-16:00; only 14:00-16:00 is contested.
    const conflict = findVenueConflict(v, at("2026-10-21", "09:00", "16:00"));
    expect(conflict?.shared).toEqual(at("2026-10-21", "14:00", "16:00"));
  });
});

describe("findVenueConflict — confirm time (AC6)", () => {
  it("blocks confirming over an existing approved booking", () => {
    const v = venue({ bookings: [booking({ ...MORNING("2026-10-21") })] });
    expect(findVenueConflict(v, MORNING("2026-10-21"), { scope: "approved" })?.kind).toBe("booked");
  });

  // The difference that matters: at request time a pending sibling blocks, at
  // confirm time it must not - approving one request is how Venue Staff pick
  // between two, so a rival hold cannot be allowed to veto the decision.
  it("does NOT block confirming merely because another request is pending", () => {
    const v = venue({ bookings: [booking({ ...MORNING("2026-10-21"), status: "pending" })] });
    expect(findVenueConflict(v, MORNING("2026-10-21"), { scope: "active" })?.kind).toBe("on_hold");
    expect(findVenueConflict(v, MORNING("2026-10-21"), { scope: "approved" })).toBeNull();
  });

  it("does not let a booking conflict with itself", () => {
    const mine = booking({ ...MORNING("2026-10-21"), id: "booking-1", eventId: "mine" });
    const v = venue({ bookings: [mine] });
    expect(findVenueConflict(v, mine, { bookingId: mine.id, scope: "approved" })).toBeNull();
  });

  it("refuses approval when another event's booking was approved first", () => {
    const rival = booking({ ...MORNING("2026-10-21"), id: "booking-rival" });
    const mine = booking({ ...MORNING("2026-10-21"), id: "booking-mine", eventId: "mine", status: "pending" });
    const v = venue({ bookings: [rival, mine] });

    const conflict = findVenueConflict(v, mine, { bookingId: mine.id, scope: "approved" });
    expect(conflict?.kind).toBe("booked");
    expect(conflict?.booking?.id).toBe("booking-rival");
    expect(describeVenueConflict(v.name, conflict!)).toContain("EVT-000042 Product Showcase");
  });

  it("refuses approval when the room has since been blocked", () => {
    const mine = booking({ ...MORNING("2026-11-20"), id: "booking-mine", status: "pending" });
    const v = venue({
      bookings: [mine],
      unavailability: [{ startsAt: sgt("2026-11-20", "00:00"), endsAt: sgt("2026-11-21", "00:00"), reason: "maintenance" }],
    });
    const conflict = findVenueConflict(v, mine, { bookingId: mine.id, scope: "approved" });
    expect(conflict?.kind).toBe("unavailable");
    expect(describeVenueConflict(v.name, conflict!)).toContain("unavailable");
  });
});

describe("findDuplicateRequest — the same request twice (AC4)", () => {
  const holder = { eventId: "mine", sessionId: null };

  it("finds the same event's earlier pending or approved request at overlapping times", () => {
    for (const status of ["pending", "approved"]) {
      const earlier = booking({ ...MORNING("2026-10-21"), eventId: "mine", status });
      expect(findDuplicateRequest(venue({ bookings: [earlier] }), MORNING("2026-10-21"), holder)).toBe(earlier);
    }
  });

  it("compares the times asked for only, not setup and turnaround", () => {
    const earlier = booking({ ...at("2026-10-21", "09:00", "10:00"), eventId: "mine", status: "pending" });
    const v = venue({ setupMinutes: 30, teardownMinutes: 30, bookings: [earlier] });
    expect(findDuplicateRequest(v, at("2026-10-21", "10:00", "11:00"), holder)).toBeNull();
  });

  // SPM-81 AC4 (decided 2026-10-10): a repeat is per event, not per session.
  // Before SPM-81 two sessions of one event could hold a room at the same time.
  it("SPM-81-TC09: finds another session's request for the same room at overlapping times", () => {
    const day1 = booking({ ...MORNING("2026-10-21"), eventId: "mine", sessionId: "day-1", status: "pending" });
    expect(findDuplicateRequest(venue({ bookings: [day1] }), MORNING("2026-10-21"), { eventId: "mine", sessionId: "day-2" })).toBe(day1);
  });

  it("SPM-81-TC09: lets two sessions of one event use a room one after the other", () => {
    const first = booking({ ...at("2026-10-21", "09:00", "10:00"), eventId: "mine", sessionId: "day-1", status: "pending" });
    const v = venue({ setupMinutes: 30, teardownMinutes: 30, bookings: [first] });
    expect(findDuplicateRequest(v, at("2026-10-21", "10:00", "11:00"), { eventId: "mine", sessionId: "day-2" })).toBeNull();
  });
});

describe("describeVenueConflict — AC9, naming what is in the way", () => {
  it("SPM-93-TC09: names the event, and the date and minutes both need", () => {
    const v = venue({ setupMinutes: 30, teardownMinutes: 45, bookings: [booking({ ...at("2027-06-08", "10:00", "12:00"), eventTitle: "SPM93 Morning Masterclass" })] });
    const conflict = findVenueConflict(v, at("2027-06-08", "08:15", "09:00"))!;
    expect(describeVenueConflict("SPM93 Studio", conflict)).toBe(
      "SPM93 Studio is already booked for EVT-000042 SPM93 Morning Masterclass on 8 Jun 2027, 09:30–09:45."
    );
  });

  it("names a pending hold as a hold, not a booking", () => {
    const v = venue({ bookings: [booking({ ...AFTERNOON("2026-10-21"), status: "pending" })] });
    const conflict = findVenueConflict(v, AFTERNOON("2026-10-21"))!;
    expect(describeVenueConflict(v.name, conflict)).toBe(
      "Marina Auditorium is on hold for EVT-000042 Product Showcase on 21 Oct 2026, 14:00–16:00."
    );
  });

  it("gives the reason and the room's whole closure for an unavailable room", () => {
    const v = venue({
      unavailability: [{ startsAt: sgt("2026-11-20", "00:00"), endsAt: sgt("2026-11-22", "00:00"), reason: "internal_activity" }],
    });
    const conflict = findVenueConflict(v, MORNING("2026-11-20"))!;
    expect(describeVenueConflict(v.name, conflict)).toBe(
      "Marina Auditorium is unavailable at this time (internal activity, 20 Nov 2026, 00:00 – 22 Nov 2026, 00:00)."
    );
  });

  it("SPM-93-TC12: gives a part-day closure its times", () => {
    const v = venue({ setupMinutes: 30, unavailability: [{ ...at("2027-06-16", "14:00", "18:00"), reason: "maintenance" }] });
    const conflict = findVenueConflict(v, at("2027-06-16", "18:15", "20:00"))!;
    expect(describeVenueConflict("SPM93 Studio", conflict)).toBe(
      "SPM93 Studio is unavailable at this time (maintenance, 16 Jun 2027, 14:00–18:00)."
    );
  });

  // The search screen loads no event labels, so the message must still work.
  it("falls back to the period when the event cannot be named", () => {
    const v = venue({ bookings: [{ ...MORNING("2026-10-21"), eventId: "other", status: "approved" }] });
    const conflict = findVenueConflict(v, MORNING("2026-10-21"))!;
    expect(describeVenueConflict(v.name, conflict)).toBe("Marina Auditorium is already booked on 21 Oct 2026, 09:00–11:00.");
  });

  it("says another event for a hold that cannot be named", () => {
    const v = venue({ bookings: [{ ...MORNING("2026-10-21"), eventId: "other", status: "pending" }] });
    const conflict = findVenueConflict(v, MORNING("2026-10-21"))!;
    expect(describeVenueConflict(v.name, conflict)).toBe("Marina Auditorium is on hold for another event on 21 Oct 2026, 09:00–11:00.");
  });
});
