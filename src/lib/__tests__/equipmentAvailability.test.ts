import { describe, it, expect } from "vitest";
import {
  EQUIPMENT_TRANSFER_PREP_MS,
  allLinesAvailable,
  blockedDays,
  checkAvailability,
  committedQuantity,
  dayIndex,
  dayStart,
  equipmentLeavesAt,
  transferLeadFor,
  type Commitment,
} from "../equipmentAvailability";

// Times are written in Singapore time (the day boundary the rules use).
const sgt = (iso: string) => new Date(`${iso}:00+08:00`);
const HOUR = 60 * 60 * 1000;

function commitment(title: string, start: string, end: string, quantity = 1, transferLeadMs = 0): Commitment {
  return { eventTitle: title, quantity, startsAt: sgt(start), endsAt: sgt(end), transferLeadMs };
}

// One unit of one item, checked for an event on the given times, against other
// events' commitments. Mirrors the "Lighting Rig" cases in SPM-48.
function check(opts: {
  start: string;
  end: string;
  commitments?: Commitment[];
  total?: number;
  maintenance?: number;
  requested?: number;
  isActive?: boolean;
  transferLeadMs?: number;
}) {
  return checkAvailability({
    totalQuantity: opts.total ?? 1,
    quantityInMaintenance: opts.maintenance ?? 0,
    isActive: opts.isActive ?? true,
    requested: opts.requested ?? 1,
    startsAt: sgt(opts.start),
    endsAt: sgt(opts.end),
    transferLeadMs: opts.transferLeadMs ?? 0,
    commitments: opts.commitments ?? [],
  });
}

describe("Singapore calendar days", () => {
  it("counts a day from 00:00 Singapore time, not UTC", () => {
    // 07:00 SGT on 12 Oct is still 11 Oct in UTC, but is 12 Oct here.
    expect(dayIndex(sgt("2026-10-12T07:00"))).toBe(dayIndex(sgt("2026-10-12T20:00")));
    expect(dayIndex(sgt("2026-10-13T00:00"))).toBe(dayIndex(sgt("2026-10-12T23:59")) + 1);
  });

  it("dayStart returns the start of that Singapore day", () => {
    expect(dayStart(dayIndex(sgt("2026-10-13T15:00"))).getTime()).toBe(sgt("2026-10-13T00:00").getTime());
  });
});

describe("blockedDays (AC5)", () => {
  it("blocks from the collection day (D-1) through the Return Day", () => {
    const days = blockedDays(sgt("2026-10-12T10:00"), sgt("2026-10-12T16:00"));
    expect(days.firstDay).toBe(dayIndex(sgt("2026-10-11T12:00")));
    expect(days.lastDay).toBe(dayIndex(sgt("2026-10-12T12:00")));
  });

  it("treats an event ending at exactly 00:00 as ending the day before", () => {
    const days = blockedDays(sgt("2026-10-12T19:00"), sgt("2026-10-13T00:00"));
    expect(days.lastDay).toBe(dayIndex(sgt("2026-10-12T12:00")));
  });

  it("does not add time after the event: a 23:30 finish keeps the Return Day", () => {
    const days = blockedDays(sgt("2026-10-26T19:00"), sgt("2026-10-26T23:30"), EQUIPMENT_TRANSFER_PREP_MS);
    expect(days.lastDay).toBe(dayIndex(sgt("2026-10-26T12:00")));
  });

  it("covers every day of a multi-day reservation", () => {
    const days = blockedDays(sgt("2026-10-12T09:00"), sgt("2026-10-14T17:00"));
    expect(days.lastDay - days.firstDay).toBe(3); // 11, 12, 13, 14 Oct
  });

  it("reaches back further than D-1 only when the transfer time is longer than that", () => {
    const short = blockedDays(sgt("2026-10-12T01:00"), sgt("2026-10-12T05:00"), 2 * HOUR);
    expect(short.firstDay).toBe(dayIndex(sgt("2026-10-11T12:00")));
    const long = blockedDays(sgt("2026-10-12T10:00"), sgt("2026-10-12T16:00"), 40 * HOUR);
    expect(long.firstDay).toBe(dayIndex(sgt("2026-10-10T12:00")));
  });
});

describe("transfer time (AC6)", () => {
  it("leaves the fixed transfer time before the event starts", () => {
    const leavesAt = equipmentLeavesAt(sgt("2026-10-21T11:00"), EQUIPMENT_TRANSFER_PREP_MS);
    expect(leavesAt.getTime()).toBe(sgt("2026-10-21T09:00").getTime());
  });

  it("the fixed time is 2 hours", () => {
    expect(EQUIPMENT_TRANSFER_PREP_MS).toBe(2 * HOUR);
  });

  it("applies transfer time when the equipment is in ConnectSphere storage", () => {
    expect(transferLeadFor(null, "venue-a")).toEqual({ leadMs: EQUIPMENT_TRANSFER_PREP_MS, venueChosen: true });
  });

  it("applies transfer time when the equipment is at a different venue", () => {
    expect(transferLeadFor("venue-b", "venue-a").leadMs).toBe(EQUIPMENT_TRANSFER_PREP_MS);
  });

  it("adds no transfer time when the equipment is already at the event venue", () => {
    expect(transferLeadFor("venue-a", "venue-a")).toEqual({ leadMs: 0, venueChosen: true });
  });

  it("adds no transfer time, and says so, when the event has no venue yet", () => {
    expect(transferLeadFor(null, null)).toEqual({ leadMs: 0, venueChosen: false });
  });
});

describe("which requests hold stock", () => {
  const base = { status: "reserved", quantityReserved: 2, eventStatus: "confirmed" };

  it("counts a reserved request by quantity reserved", () => {
    expect(committedQuantity(base)).toBe(2);
  });

  it("counts a partially fulfilled request by quantity reserved, not requested", () => {
    expect(committedQuantity({ ...base, status: "partially_fulfilled", quantityReserved: 2 })).toBe(2);
  });

  it.each(["requested", "under_review", "unavailable", "cancelled"])("ignores a %s request", (status) => {
    expect(committedQuantity({ ...base, status })).toBe(0);
  });

  it.each(["cancelled", "postponed", "rejected", "draft"])("ignores requests of a %s event", (eventStatus) => {
    expect(committedQuantity({ ...base, eventStatus })).toBe(0);
  });

  it("treats a missing quantity as nothing held", () => {
    expect(committedQuantity({ ...base, quantityReserved: null })).toBe(0);
  });
});

describe("checkAvailability", () => {
  describe("type and quantity (AC1, AC2)", () => {
    it("is available when stock exceeds the request", () => {
      const r = check({ start: "2026-10-01T09:00", end: "2026-10-01T17:00", total: 5, requested: 3 });
      expect(r).toMatchObject({ status: "available", available: 5, reservedElsewhere: 0, shortfall: 0 });
    });

    it("is available when the request exactly equals stock", () => {
      const r = check({ start: "2026-10-01T09:00", end: "2026-10-01T17:00", total: 4, requested: 4 });
      expect(r.status).toBe("available");
    });

    it("is partial when the request is one more than stock", () => {
      const r = check({ start: "2026-10-01T09:00", end: "2026-10-01T17:00", total: 4, requested: 5 });
      expect(r).toMatchObject({ status: "partial", available: 4, shortfall: 1 });
    });

    it("is partial with the shortfall when the request far exceeds stock", () => {
      const r = check({ start: "2026-10-01T09:00", end: "2026-10-01T17:00", total: 5, requested: 10 });
      expect(r).toMatchObject({ status: "partial", available: 5, shortfall: 5 });
    });

    it("is unavailable when the item has no stock at all", () => {
      const r = check({ start: "2026-10-01T09:00", end: "2026-10-01T17:00", total: 0, requested: 1 });
      expect(r).toMatchObject({ status: "unavailable", available: 0 });
    });
  });

  describe("dates and overlap (AC3, AC4)", () => {
    it("removes units held by an overlapping event", () => {
      const r = check({
        start: "2026-10-12T11:00",
        end: "2026-10-12T13:00",
        total: 3,
        requested: 2,
        commitments: [commitment("Board Meeting", "2026-10-12T10:00", "2026-10-12T12:00", 2)],
      });
      expect(r).toMatchObject({ status: "partial", available: 1, reservedElsewhere: 2, shortfall: 1 });
    });

    it("ignores an event months away", () => {
      const r = check({
        start: "2027-01-15T18:00",
        end: "2027-01-15T22:00",
        total: 3,
        requested: 3,
        commitments: [commitment("Board Meeting", "2026-10-12T10:00", "2026-10-12T12:00", 2)],
      });
      expect(r).toMatchObject({ status: "available", available: 3 });
    });

    it("sums several overlapping commitments", () => {
      const r = check({
        start: "2026-10-12T09:00",
        end: "2026-10-12T17:00",
        total: 5,
        requested: 3,
        commitments: [
          commitment("A", "2026-10-12T09:00", "2026-10-12T12:00", 2),
          commitment("B", "2026-10-12T14:00", "2026-10-12T17:00", 1),
        ],
      });
      expect(r).toMatchObject({ available: 2, reservedElsewhere: 3, status: "partial" });
    });

    it("ignores a commitment of zero units", () => {
      const r = check({
        start: "2026-10-12T09:00",
        end: "2026-10-12T17:00",
        commitments: [commitment("A", "2026-10-12T09:00", "2026-10-12T12:00", 0)],
      });
      expect(r.status).toBe("available");
    });
  });

  describe("D-1 to Return Day+1 (AC5)", () => {
    const gala = commitment("Gala Dinner", "2026-10-12T10:00", "2026-10-12T16:00");

    it("is unavailable the day after the Return Day, and says when it is free again", () => {
      const r = check({ start: "2026-10-13T18:00", end: "2026-10-13T21:00", commitments: [gala] });
      expect(r.status).toBe("unavailable");
      expect(r.heldBy).toEqual([
        { eventTitle: "Gala Dinner", quantity: 1, availableAgainFrom: sgt("2026-10-13T00:00") },
      ]);
    });

    it("is available two days after the Return Day", () => {
      const r = check({ start: "2026-10-14T18:00", end: "2026-10-14T21:00", commitments: [gala] });
      expect(r.status).toBe("available");
    });

    it("is unavailable the day before another reservation's collection day", () => {
      const wrapUp = commitment("Workshop Wrap-up", "2026-10-14T10:00", "2026-10-14T16:00");
      const r = check({ start: "2026-10-13T10:00", end: "2026-10-13T16:00", commitments: [wrapUp] });
      expect(r.status).toBe("unavailable");
      expect(r.heldBy[0].availableAgainFrom).toEqual(sgt("2026-10-15T00:00"));
    });

    it("is available two days before another reservation's collection day", () => {
      const wrapUp = commitment("Workshop Wrap-up", "2026-10-14T10:00", "2026-10-14T16:00");
      const r = check({ start: "2026-10-12T10:00", end: "2026-10-12T16:00", commitments: [wrapUp] });
      expect(r.status).toBe("available");
    });

    it("blocks a multi-day reservation until the day after its last day", () => {
      const expo = commitment("Three-Day Expo", "2026-10-12T09:00", "2026-10-14T17:00");
      const after = check({ start: "2026-10-15T18:00", end: "2026-10-15T21:00", commitments: [expo] });
      const later = check({ start: "2026-10-16T18:00", end: "2026-10-16T21:00", commitments: [expo] });
      expect(after.status).toBe("unavailable");
      expect(later.status).toBe("available");
    });

    it("a late-night finish does not push the Return Day into the next day", () => {
      const lateGala = commitment("Late Gala", "2026-10-26T19:00", "2026-10-26T23:30", 1, EQUIPMENT_TRANSFER_PREP_MS);
      const r = check({ start: "2026-10-28T10:00", end: "2026-10-28T16:00", commitments: [lateGala] });
      expect(r.status).toBe("available");
    });

    it("two events on the same day cannot share one unit, even at different times", () => {
      const morning = commitment("Morning Workshop", "2026-10-28T09:00", "2026-10-28T12:00");
      const r = check({ start: "2026-10-28T18:00", end: "2026-10-28T21:00", commitments: [morning] });
      expect(r.status).toBe("unavailable");
      expect(r.heldBy[0].availableAgainFrom).toEqual(sgt("2026-10-29T00:00"));
    });

    it("two events on the same day can both be supported when stock covers both", () => {
      const morning = commitment("Morning Workshop", "2026-10-28T09:00", "2026-10-28T12:00");
      const r = check({ start: "2026-10-28T18:00", end: "2026-10-28T21:00", total: 2, commitments: [morning] });
      expect(r).toMatchObject({ status: "available", available: 1, reservedElsewhere: 1 });
    });

    it("uses each commitment's own transfer time when working out its blocked days", () => {
      // Held for a 01:00 start with a 40h transfer: leaves 10 Oct, so it is
      // blocked 10-12 Oct and an event on 10 Oct (collected 9 Oct, Return Day
      // 10 Oct) runs into it. Without the transfer time the hold would start
      // on 11 Oct and that same event would be fine.
      const far = commitment("Far Away", "2026-10-12T01:00", "2026-10-12T05:00", 1, 40 * HOUR);
      const near = commitment("Far Away", "2026-10-12T01:00", "2026-10-12T05:00", 1, 0);
      const args = { start: "2026-10-10T10:00", end: "2026-10-10T16:00" };
      expect(check({ ...args, commitments: [far] }).status).toBe("unavailable");
      expect(check({ ...args, commitments: [near] }).status).toBe("available");
    });
  });

  describe("transfer time on the event being checked (AC6)", () => {
    it("reports when the equipment leaves", () => {
      const r = check({
        start: "2026-10-21T11:00",
        end: "2026-10-21T15:00",
        transferLeadMs: EQUIPMENT_TRANSFER_PREP_MS,
      });
      expect(r.leavesAt).toEqual(sgt("2026-10-21T09:00"));
    });

    it("leaves at the event start when no transfer is needed", () => {
      const r = check({ start: "2026-10-21T11:00", end: "2026-10-21T15:00", transferLeadMs: 0 });
      expect(r.leavesAt).toEqual(sgt("2026-10-21T11:00"));
    });
  });

  describe("equipment recorded as unavailable (AC7)", () => {
    it("takes units in maintenance off the available count", () => {
      const r = check({ start: "2026-10-01T09:00", end: "2026-10-01T17:00", total: 5, maintenance: 2, requested: 3 });
      expect(r).toMatchObject({ status: "available", available: 3, inMaintenance: 2 });
    });

    it("is unavailable when every unit is in maintenance", () => {
      const r = check({ start: "2026-10-01T09:00", end: "2026-10-01T17:00", total: 2, maintenance: 2 });
      expect(r.status).toBe("unavailable");
    });

    it("never goes below zero when maintenance and reservations exceed the total", () => {
      const r = check({
        start: "2026-10-12T09:00",
        end: "2026-10-12T17:00",
        total: 2,
        maintenance: 2,
        commitments: [commitment("A", "2026-10-12T09:00", "2026-10-12T12:00", 2)],
      });
      expect(r.available).toBe(0);
    });

    it("is unavailable when the item is retired, whatever total is recorded", () => {
      const r = check({ start: "2026-10-01T09:00", end: "2026-10-01T17:00", total: 10, isActive: false });
      expect(r).toMatchObject({ status: "unavailable", available: 0, total: 10 });
    });
  });

  describe("the indicator (AC8)", () => {
    it("shows the banner unless every line is available", () => {
      expect(allLinesAvailable([{ status: "available" }, { status: "available" }])).toBe(true);
      expect(allLinesAvailable([{ status: "available" }, { status: "partial" }])).toBe(false);
      expect(allLinesAvailable([{ status: "unavailable" }])).toBe(false);
    });

    it("treats a request with no lines as nothing missing", () => {
      expect(allLinesAvailable([])).toBe(true);
    });
  });
});
