import { describe, it, expect } from "vitest";
import {
  SLOTS,
  SLOT_BOUNDARIES,
  localDayKey,
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
      expect(fromMinute).toBeGreaterThanOrEqual(previousEnd);
      previousEnd = toMinute;
    }
  });

  it("labels each slot from the table rather than hard-coded text", () => {
    expect(slotRangeLabel("AM")).toBe("08:00–12:00");
    expect(slotRangeLabel("PM")).toBe("12:00–18:00");
    expect(slotRangeLabel("Night")).toBe("18:00–23:00");
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

describe("occupiedWindow - setup and turnaround", () => {
  it("widens a booking by the venue's own setup and teardown", () => {
    const booking = at("2026-09-28T09:00:00", "2026-09-28T17:00:00");
    const window = occupiedWindow(booking, { setupMinutes: 60, teardownMinutes: 30 });
    expect(window.startsAt).toEqual(sgt("2026-09-28T08:00:00"));
    expect(window.endsAt).toEqual(sgt("2026-09-28T17:30:00"));
  });

  it("leaves a booking untouched when the venue has no turnaround", () => {
    const booking = at("2026-09-28T09:00:00", "2026-09-28T17:00:00");
    const window = occupiedWindow(booking, NO_TURNAROUND);
    expect(window).toEqual(booking);
  });

  it("does not mutate the booking it was given", () => {
    const booking = at("2026-09-28T09:00:00", "2026-09-28T17:00:00");
    occupiedWindow(booking, { setupMinutes: 240, teardownMinutes: 180 });
    expect(booking.startsAt).toEqual(sgt("2026-09-28T09:00:00"));
  });

  it("pulls a booking into a slot it does not nominally touch", () => {
    // AC2's actual point. A 13:00 start is PM only - but Jurong Expo Floor's
    // 240-minute setup means the room is occupied from 09:00, so AM is gone.
    const booking = at("2026-09-28T13:00:00", "2026-09-28T17:00:00");
    expect(slotsCovered(booking)).toEqual([{ day: "2026-09-28", slot: "PM" }]);

    const withSetup = occupiedWindow(booking, { setupMinutes: 240, teardownMinutes: 180 });
    expect(slotsCovered(withSetup)).toEqual([
      { day: "2026-09-28", slot: "AM" },
      { day: "2026-09-28", slot: "PM" },
      { day: "2026-09-28", slot: "Night" },
    ]);
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
    expect(slotsCovered(at("2026-09-28T09:00:00", "2026-09-28T19:00:00"))).toEqual([
      { day, slot: "AM" },
      { day, slot: "PM" },
      { day, slot: "Night" },
    ]);
  });

  it("treats the interval as half-open at both ends", () => {
    // Ends exactly when PM starts: AM only.
    expect(slotsCovered(at("2026-09-28T08:00:00", "2026-09-28T12:00:00"))).toEqual([
      { day, slot: "AM" },
    ]);
    // Starts exactly when PM starts: PM only, not the tail of AM.
    expect(slotsCovered(at("2026-09-28T12:00:00", "2026-09-28T13:00:00"))).toEqual([
      { day, slot: "PM" },
    ]);
  });

  it("marks a slot from one minute of overlap", () => {
    expect(slotsCovered(at("2026-09-28T11:59:00", "2026-09-28T12:01:00"))).toEqual([
      { day, slot: "AM" },
      { day, slot: "PM" },
    ]);
  });

  it("splits a booking that runs past midnight across two days", () => {
    // Slots never cross midnight, so this is two days' cells, not one odd one.
    // 22:00-09:00 touches Night on the 28th, then AM on the 29th. Nothing in
    // between, because 23:00-08:00 is in no slot at all.
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
    // 23:00-08:00 is covered by no slot under the provisional boundaries.
    // This is the case minutesOutsideSlots() exists to warn about.
    expect(slotsCovered(at("2026-09-28T23:15:00", "2026-09-28T23:45:00"))).toEqual([]);
  });

  it("orders cells by day, then by slot", () => {
    const cells = slotsCovered(at("2026-09-28T17:00:00", "2026-09-29T13:00:00"));
    expect(cells).toEqual([
      { day: "2026-09-28", slot: "PM" },
      { day: "2026-09-28", slot: "Night" },
      { day: "2026-09-29", slot: "AM" },
      { day: "2026-09-29", slot: "PM" },
    ]);
  });
});

describe("minutesOutsideSlots", () => {
  it("reports nothing for a booking inside the grid", () => {
    expect(minutesOutsideSlots(at("2026-09-28T09:00:00", "2026-09-28T17:00:00"))).toBe(0);
  });

  it("reports the whole booking when it falls in the uncovered gap", () => {
    expect(minutesOutsideSlots(at("2026-09-28T23:15:00", "2026-09-28T23:45:00"))).toBe(30);
  });

  it("reports only the part that falls outside", () => {
    // 06:00-10:00 at a venue that opens at 06:00: two hours before AM starts.
    expect(minutesOutsideSlots(at("2026-09-28T06:00:00", "2026-09-28T10:00:00"))).toBe(120);
  });

  it("counts the overnight gap between Night and the next AM", () => {
    // 22:00-09:00: 23:00-08:00 is nine hours in no slot.
    expect(minutesOutsideSlots(at("2026-09-28T22:00:00", "2026-09-29T09:00:00"))).toBe(9 * 60);
  });

  it("agrees with slotsCovered about whether anything is covered", () => {
    const cases: [string, string][] = [
      ["2026-09-28T09:00:00", "2026-09-28T10:00:00"],
      ["2026-09-28T23:15:00", "2026-09-28T23:45:00"],
      ["2026-09-28T22:00:00", "2026-09-29T09:00:00"],
      ["2026-09-28T06:00:00", "2026-09-28T07:00:00"],
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
