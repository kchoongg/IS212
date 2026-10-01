import { describe, it, expect } from "vitest";
import { coversSchedule, requestedWindow } from "../venueBookingRequest";
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
