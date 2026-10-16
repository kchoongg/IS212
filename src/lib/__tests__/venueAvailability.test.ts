import { describe, it, expect } from "vitest";
import {
  DEFAULT_AVAILABILITY_DAYS,
  MAX_AVAILABILITY_DAYS,
  buildAvailability,
  resolveAvailabilityRange,
  type AvailabilityBlockInput,
  type AvailabilityHoldInput,
  type AvailabilityBookingInput,
  type AvailabilityVenue,
  type ScheduleEntry,
} from "../venueAvailability";

// Traces to SPM-46's seven acceptance criteria, as changed by SPM-93 AC9: the
// calendar shows bookings, holds and unavailable periods at their actual times,
// with setup and turnaround shown separately from the booked time - no longer
// as AM / PM / Night cells. Times are Singapore wall-clock with an explicit
// +08:00 offset, so each case reads as what the calendar shows and the suite
// passes on a machine in any timezone.

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
  holds?: AvailabilityHoldInput[];
}) {
  return buildAvailability({
    venue: { ...VENUE, ...opts.venue },
    from: opts.from ?? "2026-09-28",
    to: opts.to ?? "2026-09-28",
    timeZone: "Asia/Singapore",
    bookings: opts.bookings ?? [],
    unavailability: opts.unavailability ?? [],
    holds: opts.holds ?? [],
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

/// A day's entries as the calendar writes them: "setup 09:30–10:00 · Title".
const lines = (entries: ScheduleEntry[]) => entries.map((e) => `${e.kind} ${e.from}–${e.to} · ${e.label}`);

describe("buildAvailability - one row per day", () => {
  it("has one row per day in the range, each with its entries", () => {
    const result = build({ from: "2026-09-28", to: "2026-09-30" });
    expect(result.days.map((d) => d.date)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"]);
    expect(result.days.every((d) => d.entries.length === 0)).toBe(true);
  });

  it("echoes the venue and range it was asked about", () => {
    const result = build({ from: "2026-09-28", to: "2026-09-29" });
    expect(result.venue).toEqual(VENUE);
    expect(result.range).toEqual({ from: "2026-09-28", to: "2026-09-29", timeZone: "Asia/Singapore" });
  });
});

describe("SPM-93 AC9 - bookings at their actual times, setup and turnaround separate", () => {
  const STUDIO = { setupMinutes: 30, teardownMinutes: 45 };

  it("SPM-93-TC15: an approved booking shows as setup, booked and turnaround entries, in time order", () => {
    const masterclass = booking("2027-06-08T10:00:00", "2027-06-08T12:00:00", { eventTitle: "SPM93 Morning Masterclass" });
    const result = build({ venue: STUDIO, from: "2027-06-08", to: "2027-06-08", bookings: [masterclass] });
    expect(lines(result.days[0].entries)).toEqual([
      "setup 09:30–10:00 · SPM93 Morning Masterclass",
      "booked 10:00–12:00 · SPM93 Morning Masterclass",
      "turnaround 12:00–12:45 · SPM93 Morning Masterclass",
    ]);
    expect(result.days[0].entries.map((e) => e.bookingId)).toEqual([masterclass.id, masterclass.id, masterclass.id]);
    expect(result.bookings[0]).toMatchObject({
      occupiedFrom: sgt("2027-06-08T09:30:00"),
      occupiedTo: sgt("2027-06-08T12:45:00"),
    });
  });

  it("SPM-93-TC16: a venue with no setup or turnaround shows only the booked time", () => {
    const demo = booking("2027-06-08T10:00:00", "2027-06-08T12:00:00", { eventTitle: "SPM93 Quick Demo" });
    const result = build({ from: "2027-06-08", to: "2027-06-08", bookings: [demo] });
    expect(lines(result.days[0].entries)).toEqual(["booked 10:00–12:00 · SPM93 Quick Demo"]);
    expect(result.bookings[0]).toMatchObject({ occupiedFrom: sgt("2027-06-08T10:00:00"), occupiedTo: sgt("2027-06-08T12:00:00") });
  });

  it("shows a booking whatever its EVENT status is", () => {
    const planning = booking("2026-12-01T09:00:00", "2026-12-01T17:00:00", { eventStatus: "planning" });
    const result = build({ from: "2026-12-01", to: "2026-12-01", bookings: [planning] });
    expect(result.days[0].entries).toHaveLength(1);
    expect(result.bookings[0].eventStatus).toBe("planning");
  });

  it("shows the old lunch and dinner gaps as booked time, not hidden (#126)", () => {
    const lunch = booking("2027-06-14T12:00:00", "2027-06-14T13:00:00", { eventTitle: "Lunch" });
    const result = build({ from: "2027-06-14", to: "2027-06-14", bookings: [lunch] });
    expect(lines(result.days[0].entries)).toEqual(["booked 12:00–13:00 · Lunch"]);
  });

  it("splits a booking crossing midnight across both days, the first ending at 24:00", () => {
    const late = booking("2027-06-08T22:00:00", "2027-06-09T01:00:00", { eventTitle: "Late" });
    const result = build({ from: "2027-06-08", to: "2027-06-09", bookings: [late] });
    expect(lines(result.days[0].entries)).toEqual(["booked 22:00–24:00 · Late"]);
    expect(lines(result.days[1].entries)).toEqual(["booked 00:00–01:00 · Late"]);
  });

  it("names an untitled event", () => {
    const result = build({ bookings: [booking("2026-09-28T10:00:00", "2026-09-28T11:00:00", { eventTitle: null })] });
    expect(result.days[0].entries[0].label).toBe("Untitled event");
  });
});

describe("SPM-93 AC9 - tentative holds (#41) at their actual times", () => {
  it("SPM-93-TC15: a hold shows as setup, requested and turnaround entries", () => {
    const lunch: AvailabilityHoldInput = {
      id: "hold-1",
      eventId: "lunch",
      eventTitle: "SPM93 Partner Lunch",
      startsAt: sgt("2027-06-10T12:00:00"),
      endsAt: sgt("2027-06-10T13:00:00"),
    };
    const result = build({ venue: { setupMinutes: 30, teardownMinutes: 45 }, from: "2027-06-10", to: "2027-06-10", holds: [lunch] });
    expect(lines(result.days[0].entries)).toEqual([
      "setup 11:30–12:00 · SPM93 Partner Lunch",
      "requested 12:00–13:00 · SPM93 Partner Lunch",
      "turnaround 13:00–13:45 · SPM93 Partner Lunch",
    ]);
    expect(result.days[0].entries.map((e) => e.holdId)).toEqual(["hold-1", "hold-1", "hold-1"]);
    expect(result.holds[0]).toMatchObject({ occupiedFrom: sgt("2027-06-10T11:30:00"), occupiedTo: sgt("2027-06-10T13:45:00") });
  });

  it("never counts a hold as a clash", () => {
    const b = booking("2026-09-28T10:00:00", "2026-09-28T12:00:00");
    const hold: AvailabilityHoldInput = { id: "h", eventId: "x", eventTitle: "X", startsAt: sgt("2026-09-28T10:00:00"), endsAt: sgt("2026-09-28T12:00:00") };
    const result = build({ bookings: [b], holds: [hold] });
    expect(result.hasOverlaps).toBe(false);
    expect(result.bookings[0].overlaps.bookingIds).toEqual([]);
  });
});

describe("SPM-93 AC9 - unavailable periods at their actual times", () => {
  it("SPM-93-TC16: a part-day period shows its own times, and nothing else of the day", () => {
    const maintenance = block("2027-06-16T14:00:00", "2027-06-16T18:00:00");
    const result = build({ venue: { setupMinutes: 30, teardownMinutes: 45 }, from: "2027-06-16", to: "2027-06-16", unavailability: [maintenance] });
    expect(lines(result.days[0].entries)).toEqual(["unavailable 14:00–18:00 · Maintenance"]);
    expect(result.days[0].entries[0].unavailabilityId).toBe(maintenance.id);
  });

  it("a multi-day period covers each whole day between its first and last", () => {
    const renovation = block("2026-09-28T12:00:00", "2026-09-30T09:00:00", { reason: "renovation" });
    const result = build({ from: "2026-09-28", to: "2026-09-30", unavailability: [renovation] });
    expect(result.days.map((d) => lines(d.entries))).toEqual([
      ["unavailable 12:00–24:00 · Renovation"],
      ["unavailable 00:00–24:00 · Renovation"],
      ["unavailable 00:00–09:00 · Renovation"],
    ]);
  });

  it("labels an underscored reason in words", () => {
    const result = build({ unavailability: [block("2026-09-28T09:00:00", "2026-09-28T10:00:00", { reason: "internal_activity" })] });
    expect(result.days[0].entries[0].label).toBe("Internal activity");
  });
});

describe("entry order", () => {
  it("lists a day's entries by start time, an earlier booking's turnaround before a later one's setup at the same minute", () => {
    const a = booking("2026-09-28T10:00:00", "2026-09-28T11:00:00", { eventTitle: "A" });
    const b = booking("2026-09-28T11:30:00", "2026-09-28T12:00:00", { eventTitle: "B" });
    const result = build({ venue: { setupMinutes: 30, teardownMinutes: 30 }, bookings: [b, a] });
    expect(lines(result.days[0].entries)).toEqual([
      "setup 09:30–10:00 · A",
      "booked 10:00–11:00 · A",
      "turnaround 11:00–11:30 · A",
      "setup 11:00–11:30 · B",
      "booked 11:30–12:00 · B",
      "turnaround 12:00–12:30 · B",
    ]);
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

  it("does not link two approved bookings at different times of the day", () => {
    const a = booking("2026-09-28T09:00:00", "2026-09-28T11:00:00");
    const b = booking("2026-09-28T14:00:00", "2026-09-28T16:00:00");
    const result = build({ bookings: [a, b] });
    expect(result.bookings.map((x) => x.overlaps.bookingIds)).toEqual([[], []]);
    expect(result.hasOverlaps).toBe(false);
  });
});

describe("a venue with no holds given", () => {
  it("treats a missing list of holds as none", () => {
    const result = buildAvailability({
      venue: VENUE,
      from: "2026-09-28",
      to: "2026-09-28",
      timeZone: "Asia/Singapore",
      bookings: [],
      unavailability: [],
    });
    expect(result.days[0].entries).toEqual([]);
  });
});

describe("the requested range", () => {
  it("keeps only the days inside the range, even for a longer booking", () => {
    const long = booking("2026-09-27T09:00:00", "2026-09-29T17:00:00", { eventTitle: "Long" });
    const result = build({ from: "2026-09-28", to: "2026-09-28", bookings: [long] });
    expect(result.days).toHaveLength(1);
    expect(lines(result.days[0].entries)).toEqual(["booked 00:00–24:00 · Long"]);
  });

  it("still shows a booking that reaches the range only through its setup", () => {
    // A 00:30 booking on the 29th with 60 min setup needs the room from 23:30 on the 28th.
    const early = booking("2026-09-29T00:30:00", "2026-09-29T02:00:00", { eventTitle: "Early" });
    const result = build({ venue: { setupMinutes: 60 }, from: "2026-09-28", to: "2026-09-28", bookings: [early] });
    expect(lines(result.days[0].entries)).toEqual(["setup 23:30–24:00 · Early"]);
    expect(result.bookings).toHaveLength(1);
  });
});
