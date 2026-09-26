import { describe, it, expect } from "vitest";
import {
  DEFAULT_AVAILABILITY_DAYS,
  MAX_AVAILABILITY_DAYS,
  buildAvailability,
  resolveAvailabilityRange,
  type AvailabilityBlockInput,
  type AvailabilityBookingInput,
  type AvailabilityVenue,
} from "../venueAvailability";

// Traces to SPM-46's seven acceptance criteria. Times are Singapore wall-clock
// with an explicit +08:00 offset, so each case reads as what the calendar shows
// and the suite passes on a machine in any timezone.

const sgt = (iso: string) => new Date(`${iso}+08:00`);

const VENUE: AvailabilityVenue = {
  id: "venue-1",
  code: "MAR-GH",
  name: "Marina Grand Hall",
  opensAt: "07:00",
  closesAt: "23:00",
  setupMinutes: 0,
  teardownMinutes: 0,
  isActive: true,
};

let seq = 0;
function booking(from: string, to: string, extra: Partial<AvailabilityBookingInput> = {}): AvailabilityBookingInput {
  seq++;
  return {
    id: `booking-${seq}`,
    startsAt: sgt(from),
    endsAt: sgt(to),
    layoutName: "theatre",
    eventId: `event-${seq}`,
    eventTitle: `Event ${seq}`,
    eventStatus: "confirmed",
    sessionLabel: null,
    ...extra,
  };
}

function block(from: string, to: string, extra: Partial<AvailabilityBlockInput> = {}): AvailabilityBlockInput {
  seq++;
  return { id: `block-${seq}`, startsAt: sgt(from), endsAt: sgt(to), reason: "maintenance", notes: null, ...extra };
}

function build(opts: {
  venue?: Partial<AvailabilityVenue>;
  from?: string;
  to?: string;
  bookings?: AvailabilityBookingInput[];
  unavailability?: AvailabilityBlockInput[];
}) {
  return buildAvailability({
    venue: { ...VENUE, ...opts.venue },
    from: opts.from ?? "2026-09-28",
    to: opts.to ?? "2026-09-28",
    timeZone: "Asia/Singapore",
    bookings: opts.bookings ?? [],
    unavailability: opts.unavailability ?? [],
  });
}

// ---------------------------------------------------------------------------

describe("resolveAvailabilityRange - AC1, choosing a period", () => {
  const today = "2026-09-22";

  it("defaults to a week from today", () => {
    expect(resolveAvailabilityRange({}, today)).toEqual({ from: "2026-09-22", to: "2026-09-28" });
    expect(DEFAULT_AVAILABILITY_DAYS).toBe(7);
  });

  it("runs a week from a given start when no end is given", () => {
    expect(resolveAvailabilityRange({ from: "2026-12-29" }, today)).toEqual({
      from: "2026-12-29",
      to: "2027-01-04",
    });
  });

  it("uses a range exactly as given", () => {
    expect(resolveAvailabilityRange({ from: "2026-10-01", to: "2026-10-31" }, today)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("accepts a single day", () => {
    expect(resolveAvailabilityRange({ from: "2026-10-01", to: "2026-10-01" }, today)).toEqual({
      from: "2026-10-01",
      to: "2026-10-01",
    });
  });

  it("rejects an end before the start", () => {
    const result = resolveAvailabilityRange({ from: "2026-10-05", to: "2026-10-01" }, today);
    expect(result).toEqual({ error: expect.stringMatching(/on or after the start/i) });
  });

  it("accepts the longest allowed range and rejects one day more", () => {
    const from = "2026-10-01";
    const lastAllowed = "2026-12-01"; // 62 days including both ends
    expect(resolveAvailabilityRange({ from, to: lastAllowed }, today)).toEqual({ from, to: lastAllowed });
    expect(resolveAvailabilityRange({ from, to: "2026-12-02" }, today)).toEqual({
      error: expect.stringContaining(`${MAX_AVAILABILITY_DAYS} days or fewer`),
    });
  });
});

describe("buildAvailability - the grid", () => {
  it("has one column per slot and one row per day in the range", () => {
    const result = build({ from: "2026-09-28", to: "2026-10-04" });
    expect(result.days.map((d) => d.date)).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
    ]);
    expect(result.slots).toEqual([
      { slot: "AM", label: "07:00–12:00" },
      { slot: "PM", label: "13:00–18:00" },
      { slot: "Night", label: "19:00–24:00" },
    ]);
  });

  it("marks every slot free when nothing is booked", () => {
    const result = build({});
    for (const cell of Object.values(result.days[0].slots)) {
      expect(cell.status).toBe("free");
    }
  });

  it("echoes the venue and range it was asked about", () => {
    const result = build({ from: "2026-09-28", to: "2026-09-29" });
    expect(result.venue.code).toBe("MAR-GH");
    expect(result.range).toEqual({ from: "2026-09-28", to: "2026-09-29", timeZone: "Asia/Singapore" });
  });
});

describe("AC3 / AC7 - approved bookings block their slots", () => {
  it("marks the slot an approved booking sits in as booked", () => {
    const b = booking("2026-09-28T14:00:00", "2026-09-28T16:00:00");
    const { days, bookings } = build({ bookings: [b] });
    expect(days[0].slots.PM).toMatchObject({ status: "booked", bookingIds: [b.id] });
    expect(days[0].slots.AM.status).toBe("free");
    expect(bookings[0]).toMatchObject({ id: b.id, eventTitle: b.eventTitle, layoutName: "theatre" });
  });

  it("blocks the slot whatever the booking's EVENT status is", () => {
    // The decision on SPM-46, pinned. Marina Grand Hall on 1 Dec 2026 has an
    // approved booking whose event is still in planning; reading "confirmed
    // bookings" by event status would show the room free and invite a
    // double-booking. The event's status is shown - it never decides.
    const planning = booking("2026-12-01T09:00:00", "2026-12-01T11:00:00", { eventStatus: "planning" });
    const { days, bookings } = build({ from: "2026-12-01", to: "2026-12-01", bookings: [planning] });
    expect(days[0].slots.AM.status).toBe("booked");
    expect(bookings[0].eventStatus).toBe("planning");
  });

  it("flags two bookings that share a slot, because a slot is consumed in full", () => {
    // #107: "If an event runs across two slots, does it consume both slots in
    // full? Yes." So two approved bookings in the same PM - even ones whose
    // own times never touch - are a double-booking, not neighbours sharing an
    // afternoon. Reported rather than assumed away: no database constraint
    // stops it, and stopping it is what this calendar is for.
    const early = booking("2026-09-28T13:00:00", "2026-09-28T14:00:00");
    const late = booking("2026-09-28T15:00:00", "2026-09-28T17:00:00");
    const result = build({ bookings: [early, late] });
    expect(result.days[0].slots.PM.bookingIds).toEqual([early.id, late.id]);
    expect(result.bookings[0].overlaps.bookingIds).toEqual([late.id]);
    expect(result.bookings[1].overlaps.bookingIds).toEqual([early.id]);
    expect(result.hasOverlaps).toBe(true);
  });

  it("flags a booking whose turnaround slot another booking already holds", () => {
    // An AM event's turnaround takes PM; a PM event holds PM. Under the old
    // minute model these two only clashed if the raw minutes touched.
    const morning = booking("2026-09-28T09:00:00", "2026-09-28T11:00:00");
    const afternoon = booking("2026-09-28T14:00:00", "2026-09-28T16:00:00");
    const result = build({
      venue: { setupMinutes: 30, teardownMinutes: 30 },
      bookings: [morning, afternoon],
    });
    expect(result.hasOverlaps).toBe(true);
  });
});

describe("AC2 - slots occupied by setup or turnaround", () => {
  it("shows the whole slot before a booking as turnaround, not booked", () => {
    // A 13:00 start is PM. Any setup at all claims the WHOLE slot before it -
    // AM - however many minutes are recorded (#108, #123).
    const b = booking("2026-09-28T13:00:00", "2026-09-28T16:00:00");
    const { days, bookings } = build({ venue: { setupMinutes: 240 }, bookings: [b] });
    expect(days[0].slots.AM).toMatchObject({ status: "turnaround", turnaroundBookingIds: [b.id], bookingIds: [] });
    expect(days[0].slots.PM).toMatchObject({ status: "booked", bookingIds: [b.id] });
    // "Room in use" now runs from the start of the setup slot.
    expect(bookings[0].occupiedFrom).toEqual(sgt("2026-09-28T07:00:00"));
  });

  it("costs one slot whether setup is 20 minutes or 240", () => {
    const b = booking("2026-09-28T13:00:00", "2026-09-28T16:00:00");
    for (const setupMinutes of [20, 240]) {
      const { days } = build({ venue: { setupMinutes }, bookings: [b] });
      expect(days[0].slots.AM.status).toBe("turnaround");
    }
  });

  it("shows teardown reaching into the next slot as turnaround", () => {
    const b = booking("2026-09-28T14:00:00", "2026-09-28T17:00:00");
    const { days } = build({ venue: { teardownMinutes: 60 }, bookings: [b] });
    expect(days[0].slots.PM.status).toBe("booked");
    expect(days[0].slots.Night.status).toBe("turnaround");
  });

  it("prefers booked over turnaround when both reach a slot", () => {
    const main = booking("2026-09-28T09:00:00", "2026-09-28T11:00:00");
    const later = booking("2026-09-28T13:00:00", "2026-09-28T15:00:00");
    // `later`'s 3-hour setup reaches back into AM, where `main` sits properly.
    const { days } = build({ venue: { setupMinutes: 180 }, bookings: [main, later] });
    expect(days[0].slots.AM.status).toBe("booked");
    expect(days[0].slots.AM.bookingIds).toContain(main.id);
    expect(days[0].slots.AM.turnaroundBookingIds).toContain(later.id);
  });

  it("tags each of a booking's cells with how it got there", () => {
    const b = booking("2026-09-28T13:00:00", "2026-09-28T16:00:00");
    const { bookings } = build({ venue: { setupMinutes: 240 }, bookings: [b] });
    expect(bookings[0].cells).toEqual([
      { day: "2026-09-28", slot: "AM", via: "turnaround" },
      { day: "2026-09-28", slot: "PM", via: "booking" },
    ]);
  });

  it("warns only about a booking the grid cannot show at all", () => {
    // Crossing the lunch gap is normal and holds AM and PM, so no warning.
    const ordinary = booking("2026-09-28T09:00:00", "2026-09-28T17:00:00");
    expect(build({ bookings: [ordinary] }).bookings[0].minutesOutsideSlots).toBe(0);

    // Entirely inside the 12:00-13:00 gap: it touches no slot and would
    // vanish from the grid, which is the case worth surfacing.
    const hidden = booking("2026-09-28T12:15:00", "2026-09-28T12:45:00");
    expect(build({ bookings: [hidden] }).bookings[0].minutesOutsideSlots).toBe(30);
  });
});

describe("AC4 - recorded unavailable periods", () => {
  it("marks every slot a maintenance block covers as unavailable", () => {
    const u = block("2026-09-28T00:00:00", "2026-09-29T00:00:00", { reason: "renovation", notes: "Floor resurfacing" });
    const { days, unavailability } = build({ unavailability: [u] });
    for (const cell of Object.values(days[0].slots)) {
      expect(cell).toMatchObject({ status: "unavailable", unavailabilityIds: [u.id] });
    }
    expect(unavailability[0]).toMatchObject({ reason: "renovation", notes: "Floor resurfacing" });
  });

  it("puts unavailable above booked when both occupy a slot", () => {
    const b = booking("2026-09-28T14:00:00", "2026-09-28T15:00:00");
    const u = block("2026-09-28T16:00:00", "2026-09-28T17:00:00");
    const { days } = build({ bookings: [b], unavailability: [u] });
    // Same PM slot, different hours: the slot reads unavailable, and still
    // lists the booking, so nothing is hidden.
    expect(days[0].slots.PM).toMatchObject({ status: "unavailable", bookingIds: [b.id], unavailabilityIds: [u.id] });
  });
});

describe("AC5 - overlapping unavailable periods are identifiable", () => {
  it("links two unavailable periods that overlap each other", () => {
    const a = block("2026-09-28T08:00:00", "2026-09-28T14:00:00");
    const b = block("2026-09-28T12:00:00", "2026-09-28T18:00:00");
    const result = build({ unavailability: [a, b] });
    expect(result.unavailability[0].overlaps.unavailabilityIds).toEqual([b.id]);
    expect(result.unavailability[1].overlaps.unavailabilityIds).toEqual([a.id]);
    expect(result.hasOverlaps).toBe(true);
  });

  it("does not count back-to-back periods as overlapping", () => {
    const a = block("2026-09-28T08:00:00", "2026-09-28T12:00:00");
    const b = block("2026-09-28T12:00:00", "2026-09-28T16:00:00");
    const result = build({ unavailability: [a, b] });
    expect(result.unavailability[0].overlaps.unavailabilityIds).toEqual([]);
    expect(result.hasOverlaps).toBe(false);
  });

  it("does not count two periods in the same slot as overlapping unless their times do", () => {
    // Both in AM, 08-09 and 10-11: same cell, no clash. Decided on intervals.
    const a = block("2026-09-28T08:00:00", "2026-09-28T09:00:00");
    const b = block("2026-09-28T10:00:00", "2026-09-28T11:00:00");
    const result = build({ unavailability: [a, b] });
    expect(result.days[0].slots.AM.unavailabilityIds).toEqual([a.id, b.id]);
    expect(result.hasOverlaps).toBe(false);
  });

  it("links an unavailable period to an approved booking it clashes with", () => {
    const b = booking("2026-09-28T14:00:00", "2026-09-28T16:00:00");
    const u = block("2026-09-28T15:00:00", "2026-09-28T17:00:00");
    const result = build({ bookings: [b], unavailability: [u] });
    expect(result.unavailability[0].overlaps.bookingIds).toEqual([b.id]);
    expect(result.bookings[0].overlaps.unavailabilityIds).toEqual([u.id]);
    expect(result.hasOverlaps).toBe(true);
  });

  it("counts maintenance during a booking's SETUP as a clash", () => {
    // The event is 13:00-16:00, but with a 3-hour setup the room is needed
    // from 10:00. Maintenance at 11:00 means it cannot be set up.
    const b = booking("2026-09-28T13:00:00", "2026-09-28T16:00:00");
    const u = block("2026-09-28T11:00:00", "2026-09-28T12:00:00");
    const result = build({ venue: { setupMinutes: 180 }, bookings: [b], unavailability: [u] });
    expect(result.bookings[0].overlaps.unavailabilityIds).toEqual([u.id]);
  });

  it("reports two approved bookings that double-book the room", () => {
    // Nothing in the database prevents this, so it is surfaced, not assumed away.
    const a = booking("2026-09-28T09:00:00", "2026-09-28T12:00:00");
    const b = booking("2026-09-28T11:00:00", "2026-09-28T13:00:00");
    const result = build({ bookings: [a, b] });
    expect(result.bookings[0].overlaps.bookingIds).toEqual([b.id]);
    expect(result.bookings[1].overlaps.bookingIds).toEqual([a.id]);
    expect(result.hasOverlaps).toBe(true);
  });
});

describe("the requested range", () => {
  it("keeps only cells inside the range, even for a longer booking", () => {
    const b = booking("2026-09-27T20:00:00", "2026-09-29T10:00:00");
    const result = build({ from: "2026-09-28", to: "2026-09-28", bookings: [b] });
    expect(result.bookings[0].cells.every((c) => c.day === "2026-09-28")).toBe(true);
    expect(result.days).toHaveLength(1);
  });

  it("still lists a booking that reaches the range only through turnaround", () => {
    // The evening BEFORE the range. A 600-minute teardown keeps the room in
    // use until 08:30 on the 28th, so the route must still fetch this booking
    // (it widens its query by turnaround for exactly this) and AM must show it.
    const b = booking("2026-09-27T20:00:00", "2026-09-27T22:30:00");
    const result = build({ from: "2026-09-28", to: "2026-09-28", venue: { teardownMinutes: 600 }, bookings: [b] });
    // Teardown to 08:30 on the 28th reaches AM.
    expect(result.days[0].slots.AM).toMatchObject({ status: "turnaround", turnaroundBookingIds: [b.id] });
  });
});

describe("opening hours and retired venues", () => {
  it("marks a slot the venue only partly covers as partial, still free", () => {
    // Orchard Studio, 08:00-21:00: Night (18-23) closes early, and AM (06-12)
    // opens late. Both are partial, and both still free - partial hours make a
    // slot shorter, not unbookable.
    const { days } = build({ venue: { opensAt: "08:00", closesAt: "21:00" } });
    expect(days[0].slots.Night).toMatchObject({ status: "free", openingHours: "partial" });
    expect(days[0].slots.AM).toMatchObject({ status: "free", openingHours: "partial" });
    expect(days[0].slots.PM.openingHours).toBe("full");
  });

  it("marks an empty slot closed when the venue is shut for all of it", () => {
    const { days } = build({ venue: { opensAt: "08:00", closesAt: "12:00" } });
    expect(days[0].slots.PM).toMatchObject({ status: "closed", openingHours: "closed" });
    expect(days[0].slots.Night.status).toBe("closed");
  });

  it("never offers a retired venue's empty slots as free", () => {
    // SPM-39 AC6: inactive venues are not presented as available options.
    const b = booking("2026-09-28T14:00:00", "2026-09-28T16:00:00");
    const { days } = build({ venue: { isActive: false }, bookings: [b] });
    expect(days[0].slots.AM.status).toBe("closed");
    // Its existing bookings are still shown - retiring hides nothing.
    expect(days[0].slots.PM.status).toBe("booked");
  });
});
