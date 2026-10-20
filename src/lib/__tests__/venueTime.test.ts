import { describe, it, expect } from "vitest";
import {
  BOOKING_STEP_MINUTES,
  addDays,
  asClock,
  atLocalTime,
  dayNumberOf,
  dayRange,
  isDayKey,
  isOnGrid,
  localDayKey,
  localDayStart,
  localMinuteOfDay,
  occupiedWindow,
  overlapping,
  parseClock,
  timeRangeLabel,
  widenToGrid,
  withinOpeningHours,
} from "../venueTime";

// SPM-93 (Book Venues in 15-Minute Units). Replaces the AM/PM/Night slots of
// src/lib/venueSlots.ts (#50, #107, #108, #123) with the Week 7 rule: bookings
// are times on a 15-minute grid (#126, #128), and a booking occupies the venue
// from its start minus the venue's setup to its end plus its turnaround (Week 7
// Customer Changes, Change #1).
//
// Times are Singapore wall-clock with an explicit +08:00 offset, so each case
// reads as the time a user sees and the suite passes in any timezone.

const sgt = (iso: string) => new Date(`${iso}+08:00`);
const at = (from: string, to: string) => ({ startsAt: sgt(from), endsAt: sgt(to) });

describe("the 15-minute grid (AC1, AC3)", () => {
  it("[SPM-93][AC1][AC3] is 15 minutes", () => {
    expect(BOOKING_STEP_MINUTES).toBe(15);
  });

  it.each(["00:00", "10:00", "10:15", "10:30", "10:45", "23:45"])("[SPM-93][AC1][AC3] accepts %s", (clock) => {
    expect(isOnGrid(clock)).toBe(true);
  });

  it.each(["10:10", "12:20", "09:59", "10:01", "23:59"])("[SPM-93][AC1][AC3] refuses %s, which is off the grid", (clock) => {
    expect(isOnGrid(clock)).toBe(false);
  });

  it.each(["", "9:00", "24:00", "10:60", "ten"])("[SPM-93][AC1][AC3] refuses %j, which is not a time", (clock) => {
    expect(isOnGrid(clock)).toBe(false);
  });
});

describe("widenToGrid (AC2)", () => {
  it("[SPM-93][AC2] SPM-93-TC01: widens an off-grid event outwards to the nearest 15 minutes", () => {
    expect(widenToGrid(at("2027-06-09T14:10:00", "2027-06-09T15:50:00"))).toEqual(
      at("2027-06-09T14:00:00", "2027-06-09T16:00:00")
    );
  });

  it("[SPM-93][AC2] SPM-93-TC02: leaves times already on the grid unchanged", () => {
    expect(widenToGrid(at("2027-06-18T14:00:00", "2027-06-18T17:30:00"))).toEqual(
      at("2027-06-18T14:00:00", "2027-06-18T17:30:00")
    );
  });

  it("[SPM-93][AC2] widens a minute past a step to the whole step", () => {
    expect(widenToGrid(at("2027-06-17T09:01:00", "2027-06-17T11:44:00"))).toEqual(
      at("2027-06-17T09:00:00", "2027-06-17T11:45:00")
    );
  });

  it("[SPM-93][AC2] drops seconds when widening", () => {
    expect(widenToGrid({ startsAt: sgt("2027-06-17T09:00:30"), endsAt: sgt("2027-06-17T10:00:30") })).toEqual(
      at("2027-06-17T09:00:00", "2027-06-17T10:15:00")
    );
  });
});

describe("occupiedWindow (AC6)", () => {
  it("[SPM-93][AC6] Week 7 example: 10:00-12:00 with 30 min setup and 45 min turnaround occupies 09:30-12:45", () => {
    expect(occupiedWindow(at("2027-06-08T10:00:00", "2027-06-08T12:00:00"), { setupMinutes: 30, teardownMinutes: 45 })).toEqual(
      at("2027-06-08T09:30:00", "2027-06-08T12:45:00")
    );
  });

  it("[SPM-93][AC6] SPM-93-TC08: a venue with no setup or turnaround is occupied for the booked times only", () => {
    expect(occupiedWindow(at("2027-06-08T10:00:00", "2027-06-08T12:00:00"), { setupMinutes: 0, teardownMinutes: 0 })).toEqual(
      at("2027-06-08T10:00:00", "2027-06-08T12:00:00")
    );
  });

  it("[SPM-93][AC6] crosses midnight when setup or turnaround does", () => {
    expect(occupiedWindow(at("2027-06-08T00:30:00", "2027-06-08T23:30:00"), { setupMinutes: 60, teardownMinutes: 60 })).toEqual(
      at("2027-06-07T23:30:00", "2027-06-09T00:30:00")
    );
  });
});

describe("overlapping (AC7)", () => {
  const masterclass = at("2027-06-08T09:30:00", "2027-06-08T12:45:00");

  it("[SPM-93][AC7] SPM-93-TC09: a period reaching 15 minutes into another overlaps it", () => {
    expect(overlapping(at("2027-06-08T07:45:00", "2027-06-08T09:45:00"), masterclass)).toBe(true);
  });

  it("[SPM-93][AC7] SPM-93-TC09: a period ending exactly as another starts does not overlap it", () => {
    expect(overlapping(at("2027-06-08T07:45:00", "2027-06-08T09:30:00"), masterclass)).toBe(false);
  });

  it("[SPM-93][AC7] SPM-93-TC10: a period starting exactly as another ends does not overlap it", () => {
    expect(overlapping(at("2027-06-08T12:45:00", "2027-06-08T14:45:00"), masterclass)).toBe(false);
  });

  it("[SPM-93][AC7] a period inside another overlaps it, both ways round", () => {
    const inside = at("2027-06-08T10:00:00", "2027-06-08T11:00:00");
    expect(overlapping(inside, masterclass)).toBe(true);
    expect(overlapping(masterclass, inside)).toBe(true);
  });
});

describe("withinOpeningHours (AC4)", () => {
  const studio = { opensAt: "07:00", closesAt: "22:00" };

  it("[SPM-93][AC4] SPM-93-TC06: a period from opening to closing fits", () => {
    expect(withinOpeningHours(studio, at("2027-06-13T07:00:00", "2027-06-13T22:00:00"))).toBe(true);
  });

  it("[SPM-93][AC4] SPM-93-TC06: a period starting a quarter-hour before opening does not fit", () => {
    expect(withinOpeningHours(studio, at("2027-06-13T06:45:00", "2027-06-13T09:45:00"))).toBe(false);
  });

  it("[SPM-93][AC4] SPM-93-TC06: a period ending a quarter-hour after closing does not fit", () => {
    expect(withinOpeningHours(studio, at("2027-06-13T19:30:00", "2027-06-13T22:15:00"))).toBe(false);
  });

  it("[SPM-93][AC4] SPM-93-TC05: the old lunch and dinner gaps are inside opening hours", () => {
    expect(withinOpeningHours(studio, at("2027-06-14T12:00:00", "2027-06-14T13:00:00"))).toBe(true);
    expect(withinOpeningHours(studio, at("2027-06-14T18:00:00", "2027-06-14T19:00:00"))).toBe(true);
  });

  it("[SPM-93][AC4] reads an end at midnight as the end of the day, not the start of the next", () => {
    expect(withinOpeningHours({ opensAt: "07:00", closesAt: "23:59" }, at("2027-06-14T22:00:00", "2027-06-15T00:00:00"))).toBe(false);
    expect(withinOpeningHours({ opensAt: "00:00", closesAt: "23:59" }, at("2027-06-14T22:00:00", "2027-06-14T23:45:00"))).toBe(true);
  });

  it("[SPM-93][AC4] does not hide a venue whose stored hours cannot be read", () => {
    expect(withinOpeningHours({ opensAt: "late", closesAt: "22:00" }, at("2027-06-14T03:00:00", "2027-06-14T04:00:00"))).toBe(true);
    expect(withinOpeningHours({ opensAt: "22:00", closesAt: "07:00" }, at("2027-06-14T03:00:00", "2027-06-14T04:00:00"))).toBe(true);
  });
});

describe("clock text", () => {
  it("[SPM-93] writes minutes of the day as HH:MM, with the end of the day as 24:00", () => {
    expect(asClock(0)).toBe("00:00");
    expect(asClock(9 * 60 + 30)).toBe("09:30");
    expect(asClock(1440)).toBe("24:00");
  });

  it("[SPM-93] reads HH:MM into minutes of the day", () => {
    expect(parseClock("08:30")).toBe(510);
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("8:30")).toBeNull();
  });

  it("[SPM-93] puts a wall-clock time on a Singapore day", () => {
    expect(atLocalTime("2027-06-08", "09:30")).toEqual(sgt("2027-06-08T09:30:00"));
  });

  it("[SPM-93][AC1] SPM-93-TC01: a range within one day is written as its times only", () => {
    expect(timeRangeLabel(at("2027-06-09T13:30:00", "2027-06-09T16:45:00"))).toBe("13:30–16:45");
  });

  it("[SPM-93] a range ending at midnight is written as ending at 24:00", () => {
    expect(timeRangeLabel(at("2027-06-09T22:00:00", "2027-06-10T00:00:00"))).toBe("22:00–24:00");
  });

  it("[SPM-93] a range over more than one day is written with its dates", () => {
    expect(timeRangeLabel(at("2027-06-09T23:30:00", "2027-06-10T00:30:00"))).toBe("9 Jun 2027, 23:30 – 10 Jun 2027, 00:30");
  });
});

describe("local time", () => {
  it("[SPM-93] buckets an instant by its Singapore day, not its UTC day", () => {
    const instant = new Date("2026-09-28T16:30:00Z");
    expect(localDayKey(instant)).toBe("2026-09-29");
    expect(localMinuteOfDay(instant)).toBe(30);
  });

  it("[SPM-93] reads midnight as hour 0, not hour 24", () => {
    const midnight = sgt("2026-09-28T00:00:00");
    expect(localDayKey(midnight)).toBe("2026-09-28");
    expect(localMinuteOfDay(midnight)).toBe(0);
  });
});

describe("calendar days", () => {
  it("[SPM-93] accepts real dates and rejects impossible or malformed ones", () => {
    expect(isDayKey("2026-09-28")).toBe(true);
    expect(isDayKey("2028-02-29")).toBe(true);
    expect(isDayKey("2026-02-31")).toBe(false);
    expect(isDayKey("2027-02-29")).toBe(false);
    expect(isDayKey("28/09/2026")).toBe(false);
    expect(dayNumberOf("nonsense")).toBeNull();
  });

  it("[SPM-93] adds days across month and year ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
  });

  it("[SPM-93] lists every day in a range, both ends included", () => {
    expect(dayRange("2026-09-29", "2026-10-01")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
    expect(dayRange("2026-09-28", "2026-09-28")).toEqual(["2026-09-28"]);
    expect(dayRange("2026-10-02", "2026-09-29")).toEqual([]);
  });

  it("[SPM-93] finds the instant a Singapore day begins", () => {
    expect(localDayStart("2026-09-28").toISOString()).toBe("2026-09-27T16:00:00.000Z");
  });
});
