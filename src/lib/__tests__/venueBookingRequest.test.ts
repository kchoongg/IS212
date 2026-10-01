import { describe, it, expect } from "vitest";
import {
  checkVenueBookingRequest,
  coversSchedule,
  defaultSlots,
  requestedWindow,
  type BookingRequestInput,
} from "../venueBookingRequest";
import { occupiedCells } from "../venueSlots";

// SPM-42 (Request Venue Booking). Slot times are the customer's (#50, in
// src/lib/venueSlots.ts): AM 07:00-12:00, PM 13:00-18:00, Night 19:00-24:00,
// Singapore time. Written with an explicit +08:00 so each case reads as the
// time a user sees.

const sgt = (iso: string) => new Date(`${iso}+08:00`);

describe("requestedWindow", () => {
  it("SPM-42-TC03: a single PM slot books the whole of PM", () => {
    const window = requestedWindow("2026-12-05", ["PM"]);
    expect(window?.startsAt).toEqual(sgt("2026-12-05T13:00:00"));
    expect(window?.endsAt).toEqual(sgt("2026-12-05T18:00:00"));
  });

  it("SPM-42-TC04: an event spanning AM and PM consumes both slots in full", () => {
    const window = requestedWindow("2026-12-05", ["AM", "PM"]);
    expect(window?.startsAt).toEqual(sgt("2026-12-05T07:00:00"));
    expect(window?.endsAt).toEqual(sgt("2026-12-05T18:00:00"));
  });

  it("SPM-42-TC04: slots given out of order still book AM to Night", () => {
    const window = requestedWindow("2026-12-05", ["Night", "AM", "PM"]);
    expect(window?.startsAt).toEqual(sgt("2026-12-05T07:00:00"));
    expect(window?.endsAt).toEqual(sgt("2026-12-06T00:00:00"));
  });

  it("SPM-42-TC05: non-contiguous slots (AM + Night) are rejected", () => {
    expect(requestedWindow("2026-12-05", ["AM", "Night"])).toBeNull();
  });

  it("SPM-42-TC05: a request with no slots is rejected", () => {
    expect(requestedWindow("2026-12-05", [])).toBeNull();
  });
});

// AC3: the stored window is the event's own slots only. Setup and turnaround
// come from the venue (#108, #123) through occupiedCells(), the same rule the
// availability calendar uses, so a slot is never counted twice.
describe("setup and turnaround on a requested window", () => {
  const SETUP_AND_TURNAROUND = { setupMinutes: 60, teardownMinutes: 60 };

  it("SPM-42-TC06: AM setup includes the previous day's Night", () => {
    const window = requestedWindow("2026-12-01", ["AM"])!;
    expect(occupiedCells(window, { setupMinutes: 60, teardownMinutes: 0 })).toEqual([
      { day: "2026-11-30", slot: "Night", via: "turnaround" },
      { day: "2026-12-01", slot: "AM", via: "booking" },
    ]);
  });

  it("SPM-42-TC06: Night turnaround includes the next day's AM", () => {
    const window = requestedWindow("2026-12-31", ["Night"])!;
    expect(occupiedCells(window, { setupMinutes: 0, teardownMinutes: 60 })).toEqual([
      { day: "2026-12-31", slot: "Night", via: "booking" },
      { day: "2027-01-01", slot: "AM", via: "turnaround" },
    ]);
  });

  it("SPM-42-TC06: a multi-slot event takes one setup slot before and one turnaround slot after", () => {
    const window = requestedWindow("2026-12-05", ["PM", "Night"])!;
    expect(occupiedCells(window, SETUP_AND_TURNAROUND)).toEqual([
      { day: "2026-12-05", slot: "AM", via: "turnaround" },
      { day: "2026-12-05", slot: "PM", via: "booking" },
      { day: "2026-12-05", slot: "Night", via: "booking" },
      { day: "2026-12-06", slot: "AM", via: "turnaround" },
    ]);
  });

  it("SPM-42-TC07: a venue needing no setup or turnaround holds only the requested slots", () => {
    const window = requestedWindow("2026-12-05", ["PM"])!;
    expect(occupiedCells(window, { setupMinutes: 0, teardownMinutes: 0 })).toEqual([
      { day: "2026-12-05", slot: "PM", via: "booking" },
    ]);
  });
});

// AC4: a session's request is checked against the session's own times, not
// the event's.
describe("coversSchedule", () => {
  const event = { startsAt: sgt("2026-12-05T09:00:00"), endsAt: sgt("2026-12-06T21:00:00") };
  const day2Afternoon = { startsAt: sgt("2026-12-06T14:00:00"), endsAt: sgt("2026-12-06T17:00:00") };

  it("SPM-42-TC09: a session's request covering the session's own slot is accepted", () => {
    const window = requestedWindow("2026-12-06", ["PM"])!;
    expect(coversSchedule(window, day2Afternoon)).toBe(true);
    // The same request could never cover the whole two-day event.
    expect(coversSchedule(window, event)).toBe(false);
  });

  it("SPM-42-TC07: a request may take more slots than the schedule needs", () => {
    expect(coversSchedule(requestedWindow("2026-12-06", ["AM", "PM"])!, day2Afternoon)).toBe(true);
  });

  it("SPM-42-TC08: a request missing a slot the schedule touches is rejected", () => {
    const morningToAfternoon = { startsAt: sgt("2026-12-06T10:00:00"), endsAt: sgt("2026-12-06T15:00:00") };
    expect(coversSchedule(requestedWindow("2026-12-06", ["PM"])!, morningToAfternoon)).toBe(false);
  });

  it("SPM-42-TC08: a request on a different date from the schedule is rejected", () => {
    expect(coversSchedule(requestedWindow("2026-12-05", ["PM"])!, day2Afternoon)).toBe(false);
  });
});

// AC4: the request form starts on the event's (or session's) own date and slots.
describe("defaultSlots", () => {
  it("SPM-42-TC04: an event running 09:00-17:00 starts on its date with AM and PM ticked", () => {
    expect(defaultSlots({ startsAt: sgt("2027-03-06T09:00:00"), endsAt: sgt("2027-03-06T17:00:00") })).toEqual({
      day: "2027-03-06",
      slots: ["AM", "PM"],
    });
  });

  it("SPM-42-TC09: an evening session starts on its own date with Night ticked", () => {
    expect(defaultSlots({ startsAt: sgt("2027-03-03T19:00:00"), endsAt: sgt("2027-03-03T22:00:00") })).toEqual({
      day: "2027-03-03",
      slots: ["Night"],
    });
  });

  it("returns null for a schedule running over more than one day", () => {
    expect(defaultSlots({ startsAt: sgt("2027-03-06T09:00:00"), endsAt: sgt("2027-03-07T17:00:00") })).toBeNull();
  });
});

describe("checkVenueBookingRequest", () => {
  // SPM42 Town Hall at Orchard Seminar Room: 6 Mar 2027 09:00-17:00, no sessions.
  const base: BookingRequestInput = {
    eventId: "town-hall",
    eventStatus: "planning",
    holder: { kind: "event", name: "SPM42 Town Hall" },
    schedule: { startsAt: sgt("2027-03-06T09:00:00"), endsAt: sgt("2027-03-06T17:00:00") },
    activeRequest: null,
    needs: { expectedAttendance: 100, preferredLayout: "theatre", requirements: [] },
    venue: {
      name: "Orchard Seminar Room",
      building: "Orchard Hub",
      opensAt: "08:00",
      closesAt: "22:00",
      setupMinutes: 60,
      teardownMinutes: 30,
      layouts: [{ layoutName: "theatre", capacity: 120 }],
      facilityIds: [],
      bookings: [],
      unavailability: [],
    },
    day: "2027-03-06",
    slots: ["AM", "PM"],
  };
  const withBooking = (status: string, startsAt: string, endsAt: string): BookingRequestInput => ({
    ...base,
    venue: { ...base.venue, bookings: [{ eventId: "other", status, startsAt: sgt(startsAt), endsAt: sgt(endsAt) }] },
  });

  it("SPM-42-TC01: a suitable, free venue with covering slots is accepted, holding the chosen slots", () => {
    expect(checkVenueBookingRequest(base)).toEqual({
      ok: true,
      window: { startsAt: sgt("2027-03-06T07:00:00"), endsAt: sgt("2027-03-06T18:00:00") },
    });
  });

  it("SPM-42-TC02: an unsuitable venue is refused with the reason", () => {
    const result = checkVenueBookingRequest({ ...base, needs: { ...base.needs, expectedAttendance: 200 } });
    expect(result).toEqual({
      ok: false,
      error: "Orchard Seminar Room is not suitable for this event: Theatre capacity is 120 - your event expects 200.",
    });
  });

  it("SPM-42-TC02: an incomplete check (no attendance or layout yet) does not block", () => {
    const result = checkVenueBookingRequest({
      ...base,
      needs: { expectedAttendance: null, preferredLayout: null, requirements: [] },
    });
    expect(result.ok).toBe(true);
  });

  it("SPM-42-TC05: no slot ticked is refused", () => {
    expect(checkVenueBookingRequest({ ...base, slots: [] })).toEqual({ ok: false, error: "Choose at least one slot." });
  });

  it("SPM-42-TC05: AM and Night without PM are refused", () => {
    expect(checkVenueBookingRequest({ ...base, slots: ["AM", "Night"] })).toEqual({
      ok: false,
      error: "Choose slots that are next to each other — AM and Night cannot be booked without PM.",
    });
  });

  it("SPM-42-TC08: slots that do not cover the event's own time are refused", () => {
    expect(checkVenueBookingRequest({ ...base, slots: ["AM"] })).toEqual({
      ok: false,
      error: "The chosen slots do not cover the event's time (6 Mar 2027, 09:00–17:00).",
    });
  });

  it("SPM-42-TC08: a session is checked against the session's own time", () => {
    const result = checkVenueBookingRequest({
      ...base,
      holder: { kind: "session", name: "Day 2" },
      schedule: { startsAt: sgt("2027-03-02T14:00:00"), endsAt: sgt("2027-03-02T17:00:00") },
      day: "2027-03-01",
      slots: ["PM"],
    });
    expect(result).toEqual({
      ok: false,
      error: "The chosen slots do not cover the session's time (2 Mar 2027, 14:00–17:00).",
    });
  });

  it("SPM-42-TC13: an event that is not Approved or Planning is refused", () => {
    for (const status of ["draft", "submitted", "under_review", "confirmed", "cancelled"]) {
      expect(checkVenueBookingRequest({ ...base, eventStatus: status })).toEqual({
        ok: false,
        error: "A venue booking can only be requested once the event is Approved or in Planning.",
      });
    }
    expect(checkVenueBookingRequest({ ...base, eventStatus: "approved" }).ok).toBe(true);
  });

  it("SPM-42-TC14: a slot with another event's approved booking is refused", () => {
    expect(checkVenueBookingRequest(withBooking("approved", "2027-03-06T11:00:00", "2027-03-06T15:00:00"))).toEqual({
      ok: false,
      error: "Orchard Seminar Room is already booked for this time.",
    });
  });

  it("SPM-42-TC14: a slot on hold for another event's pending request is refused", () => {
    expect(checkVenueBookingRequest(withBooking("pending", "2027-03-06T09:00:00", "2027-03-06T17:00:00"))).toEqual({
      ok: false,
      error: "Orchard Seminar Room is on hold for another event at this time.",
    });
  });

  it("SPM-42-TC14: a slot when the venue is unavailable is refused", () => {
    const result = checkVenueBookingRequest({
      ...base,
      venue: {
        ...base.venue,
        unavailability: [{ reason: "maintenance", startsAt: sgt("2027-03-06T00:00:00"), endsAt: sgt("2027-03-06T23:59:00") }],
      },
    });
    expect(result).toEqual({ ok: false, error: "Orchard Seminar Room is unavailable at this time." });
  });

  it("SPM-42-TC15: a clash only through setup or turnaround slots is refused", () => {
    // The other event holds 7 Mar AM, so its setup takes 6 Mar Night - the
    // same slot this request's turnaround needs.
    expect(checkVenueBookingRequest(withBooking("approved", "2027-03-07T09:00:00", "2027-03-07T11:00:00"))).toEqual({
      ok: false,
      error: "Orchard Seminar Room is already booked for this time.",
    });
  });

  it("SPM-42-TC16: cancelled and rejected bookings do not block", () => {
    for (const status of ["cancelled", "rejected"]) {
      expect(checkVenueBookingRequest(withBooking(status, "2027-03-06T09:00:00", "2027-03-06T17:00:00")).ok).toBe(true);
    }
  });

  it("SPM-42-TC17: an event or session with an active request cannot request again", () => {
    expect(
      checkVenueBookingRequest({ ...base, activeRequest: { venueName: "Orchard Seminar Room", status: "pending" } })
    ).toEqual({
      ok: false,
      error: "SPM42 Town Hall already has a venue booking request (Orchard Seminar Room, Pending).",
    });
    expect(
      checkVenueBookingRequest({
        ...base,
        holder: { kind: "session", name: "Day 1" },
        activeRequest: { venueName: "Orchard Seminar Room", status: "approved" },
      })
    ).toEqual({ ok: false, error: "Day 1 already has a venue booking request (Orchard Seminar Room, Approved)." });
  });
});
