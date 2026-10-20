// ARCHIVED 2026-10-19 - not run. tests/archive/ is excluded from Vitest,
// Playwright, TypeScript and ESLint; this file is kept as the record of tests
// whose behaviour was changed on purpose. See docs/test-cases/DECOMMISSIONED.md.
//
// Restored from git: src/lib/__tests__/venueSlots.test.ts as it was on main
// before PR #41 (SPM-93 Book Venues in 15-Minute Units, merged 2026-10-09),
// which deleted it together with src/lib/venueSlots.ts:
//   git show 5caa053:src/lib/__tests__/venueSlots.test.ts
// Why: it tested the fixed AM / PM / Night slots (SPM-42 AC2-AC3, SPM-44 AC2,
// SPM-46 AC2). Discussion #128 (Week 7 Change #1) replaced them with times on a
// 15-minute grid, with setup and turnaround in minutes.
// Replaced by: src/lib/__tests__/venueTime.test.ts (added in the same PR) and
// the [SPM-93] tests in venueConflict, venueBookingRequest and venueAvailability.
// The tests below are as they were; their test names carry no [SPM-xx] tag.

import { describe, it, expect } from "vitest";
import {
  SLOTS,
  SLOT_BOUNDARIES,
  addDays,
  dayNumberOf,
  dayRange,
  isDayKey,
  localDayKey,
  localDayStart,
  adjacentSlot,
  hiddenMinutes,
  occupiedCells,
  openingHoursCoverage,
  openingHoursNote,
  parseClock,
  localMinuteOfDay,
  minutesOutsideSlots,
  occupiedWindow,
  slotRangeLabel,
  slotsCovered,
  type Slot,
} from "../venueSlots";

// Traces to SPM-46 AC2: availability per fixed slot for each day, including
// slots occupied by setup or turnaround time. These tests are the definition of
// what "occupies a slot" means - if the boundaries move, they move here first.
//
// Times are written as Singapore wall-clock with an explicit +08:00 offset, so
// each case reads as the time a user would actually see on the calendar. The
// suite therefore passes on a machine in any timezone.

const sgt = (iso: string) => new Date(`${iso}+08:00`);

/// A booking as the user would describe it: "Monday 14:00 to 16:00".
const at = (from: string, to: string) => ({
  startsAt: sgt(from),
  endsAt: sgt(to),
});

const NO_TURNAROUND = { setupMinutes: 0, teardownMinutes: 0 };

describe("SLOT_BOUNDARIES", () => {
  it("covers every slot exactly once, in order, without overlapping", () => {
    // The whole module derives from this table, so an inconsistent one would
    // produce a grid that double-counts or silently drops time.
    let previousEnd = -1;
    for (const slot of SLOTS) {
      const { fromMinute, toMinute } = SLOT_BOUNDARIES[slot];
      expect(toMinute).toBeGreaterThan(fromMinute);
      expect(fromMinute).toBeGreaterThanOrEqual(previousEnd); // gaps allowed, overlaps not
      previousEnd = toMinute;
    }
  });

  it("labels each slot from the table rather than hard-coded text", () => {
    expect(slotRangeLabel("AM")).toBe("07:00–12:00");
    expect(slotRangeLabel("PM")).toBe("13:00–18:00");
    expect(slotRangeLabel("Night")).toBe("19:00–24:00");
  });
});

describe("local time", () => {
  it("buckets an instant by its Singapore day, not its UTC day", () => {
    // 2026-09-28T16:30Z is already 00:30 on the 29th in Singapore. Bucketing
    // in UTC would put this booking on the wrong column of the calendar.
    const instant = new Date("2026-09-28T16:30:00Z");
    expect(localDayKey(instant)).toBe("2026-09-29");
    expect(localMinuteOfDay(instant)).toBe(30);
  });

  it("reads midnight as hour 0, not hour 24", () => {
    const midnight = sgt("2026-09-28T00:00:00");
    expect(localDayKey(midnight)).toBe("2026-09-28");
    expect(localMinuteOfDay(midnight)).toBe(0);
  });
});

describe("occupiedCells - setup and turnaround (#107, #108, #123)", () => {
  it("takes one WHOLE slot either side, however many minutes are recorded", () => {
    // 09:00-17:00 touches AM and PM. Setup claims the slot before AM - the
    // PREVIOUS day's Night - and turnaround the slot after PM, same-day Night.
    // 20 minutes and 240 minutes cost exactly the same: one slot (#108).
    const booking = at("2026-09-28T09:00:00", "2026-09-28T17:00:00");
    for (const venue of [
      { setupMinutes: 20, teardownMinutes: 15 },
      { setupMinutes: 240, teardownMinutes: 180 },
    ]) {
      expect(occupiedCells(booking, venue)).toEqual([
        { day: "2026-09-27", slot: "Night", via: "turnaround" },
        { day: "2026-09-28", slot: "AM", via: "booking" },
        { day: "2026-09-28", slot: "PM", via: "booking" },
        { day: "2026-09-28", slot: "Night", via: "turnaround" },
      ]);
    }
  });

  it("wraps a Night event's turnaround onto the next day's AM", () => {
    // #123: "A Night event requiring setup would occupy the PM slot, and its
    // turnaround would occupy the AM slot of the following day."
    const booking = at("2026-09-28T19:30:00", "2026-09-28T22:00:00");
    expect(occupiedCells(booking, { setupMinutes: 90, teardownMinutes: 60 })).toEqual([
      { day: "2026-09-28", slot: "PM", via: "turnaround" },
      { day: "2026-09-28", slot: "Night", via: "booking" },
      { day: "2026-09-29", slot: "AM", via: "turnaround" },
    ]);
  });

  it("takes no adjacent slot when the venue records none", () => {
    const booking = at("2026-09-28T09:00:00", "2026-09-28T11:00:00");
    expect(occupiedCells(booking, NO_TURNAROUND)).toEqual([
      { day: "2026-09-28", slot: "AM", via: "booking" },
    ]);
  });

  it("never downgrades a slot the booking holds by its own times", () => {
    // A booking covering all three slots: turnaround must not relabel one of
    // them as setup, and must land on the neighbouring days instead.
    const booking = at("2026-09-28T08:00:00", "2026-09-28T23:00:00");
    const cells = occupiedCells(booking, { setupMinutes: 60, teardownMinutes: 60 });
    expect(cells.filter((c) => c.day === "2026-09-28").every((c) => c.via === "booking")).toBe(true);
    expect(cells).toContainEqual({ day: "2026-09-27", slot: "Night", via: "turnaround" });
    expect(cells).toContainEqual({ day: "2026-09-29", slot: "AM", via: "turnaround" });
  });

  it("gives the room-in-use window as whole slots, not raw minutes", () => {
    const booking = at("2026-09-28T09:00:00", "2026-09-28T17:00:00");
    const window = occupiedWindow(booking, { setupMinutes: 60, teardownMinutes: 30 });
    // Previous day's Night starts 19:00; same-day Night ends at midnight.
    expect(window.startsAt).toEqual(sgt("2026-09-27T19:00:00"));
    expect(window.endsAt).toEqual(sgt("2026-09-29T00:00:00"));
  });

  it("leaves a booking that touches no slot alone", () => {
    // 12:15-12:45 is inside the lunch gap and holds nothing.
    const booking = at("2026-09-28T12:15:00", "2026-09-28T12:45:00");
    expect(occupiedCells(booking, { setupMinutes: 60, teardownMinutes: 60 })).toEqual([]);
    expect(occupiedWindow(booking, { setupMinutes: 60, teardownMinutes: 60 })).toEqual(booking);
  });

  it("does not mutate the booking it was given", () => {
    const booking = at("2026-09-28T09:00:00", "2026-09-28T17:00:00");
    occupiedCells(booking, { setupMinutes: 240, teardownMinutes: 180 });
    expect(booking.startsAt).toEqual(sgt("2026-09-28T09:00:00"));
  });

  it("pulls a booking into a slot it does not nominally touch", () => {
    // AC2's actual point. A 13:00 start is PM only - but a venue that needs
    // setup also takes the whole AM before it (#123).
    const booking = at("2026-09-28T13:00:00", "2026-09-28T17:00:00");
    expect(slotsCovered(booking)).toEqual([{ day: "2026-09-28", slot: "PM" }]);

    expect(occupiedCells(booking, { setupMinutes: 240, teardownMinutes: 180 })).toEqual([
      { day: "2026-09-28", slot: "AM", via: "turnaround" },
      { day: "2026-09-28", slot: "PM", via: "booking" },
      { day: "2026-09-28", slot: "Night", via: "turnaround" },
    ]);
  });

  it("adjacentSlot wraps at both ends of the day", () => {
    expect(adjacentSlot({ day: "2026-09-28", slot: "AM" }, -1)).toEqual({
      day: "2026-09-27",
      slot: "Night",
    });
    expect(adjacentSlot({ day: "2026-09-28", slot: "Night" }, 1)).toEqual({
      day: "2026-09-29",
      slot: "AM",
    });
    expect(adjacentSlot({ day: "2026-09-28", slot: "PM" }, -1)).toEqual({
      day: "2026-09-28",
      slot: "AM",
    });
  });
});

describe("slotsCovered", () => {
  const day = "2026-09-28";

  it("marks the one slot a short booking sits inside", () => {
    expect(slotsCovered(at("2026-09-28T14:00:00", "2026-09-28T16:00:00"))).toEqual([
      { day, slot: "PM" },
    ]);
  });

  it("marks every slot a long booking runs through", () => {
    expect(slotsCovered(at("2026-09-28T09:00:00", "2026-09-28T20:00:00"))).toEqual([
      { day, slot: "AM" },
      { day, slot: "PM" },
      { day, slot: "Night" },
    ]);
  });

  it("consumes a slot in full from any overlap at all (#107)", () => {
    // "If an event runs across two slots, does it consume both slots in full?
    // Yes." Eleven minutes of PM takes the whole of PM.
    expect(slotsCovered(at("2026-09-28T11:00:00", "2026-09-28T13:11:00"))).toEqual([
      { day, slot: "AM" },
      { day, slot: "PM" },
    ]);
  });

  it("treats the interval as half-open at both ends", () => {
    // Ends exactly when AM ends: AM only.
    expect(slotsCovered(at("2026-09-28T08:00:00", "2026-09-28T12:00:00"))).toEqual([
      { day, slot: "AM" },
    ]);
    // Starts exactly when PM starts: PM only, never the tail of AM.
    expect(slotsCovered(at("2026-09-28T13:00:00", "2026-09-28T14:00:00"))).toEqual([
      { day, slot: "PM" },
    ]);
  });

  it("marks a slot from one minute of overlap", () => {
    expect(slotsCovered(at("2026-09-28T11:59:00", "2026-09-28T13:01:00"))).toEqual([
      { day, slot: "AM" },
      { day, slot: "PM" },
    ]);
  });

  it("splits a booking that runs past midnight across two days", () => {
    // Slots never cross midnight, so this is two days' cells, not one odd one.
    // 22:00-09:00 touches Night on the 28th, then AM on the 29th. Nothing in
    // between, because 24:00-07:00 is in no slot at all.
    expect(slotsCovered(at("2026-09-28T22:00:00", "2026-09-29T09:00:00"))).toEqual([
      { day: "2026-09-28", slot: "Night" },
      { day: "2026-09-29", slot: "AM" },
    ]);
  });

  it("does not invent an extra day for a booking ending exactly at midnight", () => {
    expect(slotsCovered(at("2026-09-28T20:00:00", "2026-09-29T00:00:00"))).toEqual([
      { day: "2026-09-28", slot: "Night" },
    ]);
  });

  it("covers a multi-day maintenance block day by day", () => {
    const cells = slotsCovered(at("2026-09-28T00:00:00", "2026-09-30T00:00:00"));
    expect(cells.filter((c) => c.day === "2026-09-28")).toHaveLength(3);
    expect(cells.filter((c) => c.day === "2026-09-29")).toHaveLength(3);
    expect(cells.filter((c) => c.day === "2026-09-30")).toHaveLength(0);
  });

  it("returns nothing for a zero-length or inverted interval", () => {
    expect(slotsCovered(at("2026-09-28T14:00:00", "2026-09-28T14:00:00"))).toEqual([]);
    expect(slotsCovered(at("2026-09-28T16:00:00", "2026-09-28T14:00:00"))).toEqual([]);
  });

  it("returns nothing for a booking that falls entirely between slots", () => {
    // The customer's grid leaves 12:00-13:00, 18:00-19:00 and 24:00-07:00
    // uncovered (#50). This is the case hiddenMinutes() exists to warn about.
    expect(slotsCovered(at("2026-09-28T12:15:00", "2026-09-28T12:45:00"))).toEqual([]);
    expect(slotsCovered(at("2026-09-28T18:10:00", "2026-09-28T18:50:00"))).toEqual([]);
    expect(slotsCovered(at("2026-09-28T02:00:00", "2026-09-28T05:00:00"))).toEqual([]);
  });

  it("orders cells by day, then by slot", () => {
    const cells = slotsCovered(at("2026-09-28T17:00:00", "2026-09-29T14:00:00"));
    expect(cells).toEqual([
      { day: "2026-09-28", slot: "PM" },
      { day: "2026-09-28", slot: "Night" },
      { day: "2026-09-29", slot: "AM" },
      { day: "2026-09-29", slot: "PM" },
    ]);
  });
});

describe("minutesOutsideSlots", () => {
  it("counts the lunch gap an ordinary event runs through", () => {
    // 09:00-17:00 crosses 12:00-13:00. The minutes are really outside the
    // grid, and this function says so - but see hiddenMinutes(): the booking
    // still holds AM and PM in full, so nothing is hidden from the calendar.
    expect(minutesOutsideSlots(at("2026-09-28T09:00:00", "2026-09-28T17:00:00"))).toBe(60);
  });

  it("reports the whole booking when it falls in the uncovered gap", () => {
    expect(minutesOutsideSlots(at("2026-09-28T12:15:00", "2026-09-28T12:45:00"))).toBe(30);
  });

  it("reports only the part that falls outside", () => {
    // 05:00-09:00: the two hours before AM starts at 07:00 are in no slot.
    expect(minutesOutsideSlots(at("2026-09-28T05:00:00", "2026-09-28T09:00:00"))).toBe(120);
  });

  it("counts the overnight gap between Night and the next AM", () => {
    // 22:00-09:00: 24:00-07:00 is seven hours in no slot.
    expect(minutesOutsideSlots(at("2026-09-28T22:00:00", "2026-09-29T09:00:00"))).toBe(7 * 60);
  });

  it("hiddenMinutes warns only when the grid shows nothing at all", () => {
    // Crosses the lunch gap but is visible in AM and PM: not hidden.
    expect(hiddenMinutes(at("2026-09-28T09:00:00", "2026-09-28T17:00:00"))).toBe(0);
    // Entirely inside a gap: invisible, and the screen must say so.
    expect(hiddenMinutes(at("2026-09-28T12:15:00", "2026-09-28T12:45:00"))).toBe(30);
    expect(hiddenMinutes(at("2026-09-28T02:00:00", "2026-09-28T05:00:00"))).toBe(180);
  });

  it("agrees with slotsCovered about whether anything is covered", () => {
    const cases: [string, string][] = [
      ["2026-09-28T09:00:00", "2026-09-28T10:00:00"],
      ["2026-09-28T12:15:00", "2026-09-28T12:45:00"],
      ["2026-09-28T22:00:00", "2026-09-29T09:00:00"],
      ["2026-09-28T02:00:00", "2026-09-28T05:00:00"],
    ];
    for (const [from, to] of cases) {
      const interval = at(from, to);
      const totalMinutes = (interval.endsAt.getTime() - interval.startsAt.getTime()) / 60_000;
      const outside = minutesOutsideSlots(interval);
      const hasCells = slotsCovered(interval).length > 0;
      // Fully outside the grid <=> no cells at all.
      expect(outside === totalMinutes).toBe(!hasCells);
    }
  });
});

describe("the slot vocabulary", () => {
  it("is exactly the three the acceptance criterion names", () => {
    expect([...SLOTS]).toEqual<Slot[]>(["AM", "PM", "Night"]);
  });
});

describe("calendar days", () => {
  it("accepts real dates and rejects impossible or malformed ones", () => {
    expect(isDayKey("2026-09-28")).toBe(true);
    expect(isDayKey("2028-02-29")).toBe(true); // leap year
    // Rejected by round-tripping, not by the regex: 31 Feb would otherwise
    // quietly become 3 March.
    expect(isDayKey("2026-02-31")).toBe(false);
    expect(isDayKey("2027-02-29")).toBe(false);
    expect(isDayKey("28/09/2026")).toBe(false);
    expect(isDayKey("2026-9-28")).toBe(false);
    expect(dayNumberOf("nonsense")).toBeNull();
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
  });

  it("lists every day in a range, both ends included", () => {
    expect(dayRange("2026-09-29", "2026-10-02")).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
    expect(dayRange("2026-09-28", "2026-09-28")).toEqual(["2026-09-28"]);
    expect(dayRange("2026-10-02", "2026-09-29")).toEqual([]);
  });

  it("finds the instant a Singapore day begins", () => {
    // Local midnight on the 28th is 16:00 UTC on the 27th - a query that used
    // UTC midnight instead would miss the first eight hours of the day.
    expect(localDayStart("2026-09-28").toISOString()).toBe("2026-09-27T16:00:00.000Z");
    expect(localDayKey(localDayStart("2026-09-28"))).toBe("2026-09-28");
    expect(localMinuteOfDay(localDayStart("2026-09-28"))).toBe(0);
  });
});

describe("opening hours within a slot", () => {
  it("reads 24-hour clock times", () => {
    expect(parseClock("08:30")).toBe(510);
    expect(parseClock("00:00")).toBe(0);
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("8:30")).toBeNull();
  });

  it("reports full, partial and closed against the fixed grid", () => {
    // Orchard Studio: 08:00-21:00. AM runs from 07:00, so a room that opens at
    // 08:00 is only open for part of it.
    expect(openingHoursCoverage("AM", "08:00", "21:00")).toBe("partial");
    expect(openingHoursCoverage("PM", "08:00", "21:00")).toBe("full");
    expect(openingHoursCoverage("Night", "08:00", "21:00")).toBe("partial");
    // Opening mid-morning only partly covers AM.
    expect(openingHoursCoverage("AM", "10:00", "22:00")).toBe("partial");
    // A room shut by noon has no afternoon or evening at all.
    expect(openingHoursCoverage("PM", "08:00", "12:00")).toBe("closed");
    expect(openingHoursCoverage("Night", "08:00", "12:00")).toBe("closed");
  });

  it("treats opening early or closing late as simply full", () => {
    // Jurong Expo Floor, 06:00-23:00: opening an hour before AM does not
    // stretch the grid, it just makes AM fully covered.
    expect(openingHoursCoverage("AM", "06:00", "23:00")).toBe("full");
    // ...but Night now runs to midnight, so closing at 23:00 clips it.
    expect(openingHoursCoverage("Night", "06:00", "23:00")).toBe("partial");
    expect(openingHoursCoverage("Night", "06:00", "24:00")).toBe("full");
  });

  it("does not invent a closure from hours it cannot read", () => {
    expect(openingHoursCoverage("AM", "garbage", "22:00")).toBe("full");
    expect(openingHoursCoverage("AM", "18:00", "08:00")).toBe("full");
  });

  it("names the hours a partly-open slot is actually open for", () => {
    // One-North Auditorium, 08:00-22:00: AM opens late, Night closes early.
    expect(openingHoursNote("AM", "08:00", "22:00")).toBe("Open from 08:00");
    expect(openingHoursNote("Night", "08:00", "22:00")).toBe("Open until 22:00");
    // One-North Rooftop Terrace, 16:00-23:00: only the front of PM is clipped,
    // so it reads as "from" - and says the two hours of PM that are usable,
    // which "Limited hours" never did.
    expect(openingHoursNote("PM", "16:00", "23:00")).toBe("Open from 16:00");
    // Both ends clipped inside one slot: open 14:00-17:00 against PM 13:00-18:00.
    expect(openingHoursNote("PM", "14:00", "17:00")).toBe("Open 14:00–17:00");
  });

  it("has no note when the venue is open for all of a slot, or none of it", () => {
    expect(openingHoursNote("AM", "06:00", "23:00")).toBeNull();
    expect(openingHoursNote("PM", "08:00", "21:00")).toBeNull();
    // Shut for the whole slot - the cell already says "Closed".
    expect(openingHoursNote("AM", "16:00", "23:00")).toBeNull();
    expect(openingHoursNote("Night", "08:00", "12:00")).toBeNull();
    // Unreadable hours report "full", so they carry no note either.
    expect(openingHoursNote("AM", "garbage", "22:00")).toBeNull();
  });
});
