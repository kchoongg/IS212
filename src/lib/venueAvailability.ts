// The availability calendar for one venue over a range of days.
//
// SPM-46 "View Venue Availability". The route in
// src/app/api/venues/[id]/availability/route.ts loads the rows and calls
// buildAvailability(); everything that decides what the calendar SAYS lives
// here, as pure functions over plain data - no Prisma, no NextRequest - the same
// arrangement as src/lib/venueImpact.ts, so the rules can be tested without a
// database.
//
// What counts as a booking here (AC3, AC7 - team decision, recorded on SPM-46):
// "confirmed bookings" means VenueBooking.status = "approved", the state that
// commits the room. NOT Event.status = "confirmed". The calendar exists to stop
// double-booking, and reading it by event status was measured to hide a real,
// already-approved booking: Marina Grand Hall on 1 Dec 2026, whose event is
// still in "planning", would have shown as free. The route filters on the
// booking's own status; the event's status travels along for display only and
// never decides whether a room is taken.

import {
  SLOTS,
  addDays,
  dayRange,
  hiddenMinutes,
  occupiedCells,
  occupiedWindow,
  openingHoursCoverage,
  slotRangeLabel,
  slotsCovered,
  type Interval,
  type OpeningHoursCoverage,
  type Slot,
} from "@/lib/venueSlots";

/// The longest range one request may cover. A calendar is read a week or a
/// month at a time; this stops a single request asking for years of cells.
export const MAX_AVAILABILITY_DAYS = 62;

/// The default window when a range is not given: a week, which is what the
/// S-21 mockup shows.
export const DEFAULT_AVAILABILITY_DAYS = 7;

// ---------------------------------------------------------------------------
// INPUT - structural, so tests can use object literals
// ---------------------------------------------------------------------------

export interface AvailabilityVenue {
  id: string;
  code: string;
  name: string;
  opensAt: string;
  closesAt: string;
  setupMinutes: number;
  teardownMinutes: number;
  isActive: boolean;
}

/// An APPROVED booking. The route only ever passes approved ones; nothing here
/// re-checks, so a caller that passed a pending booking would see it block.
export interface AvailabilityBookingInput extends Interval {
  id: string;
  layoutName: string | null;
  eventId: string;
  eventTitle: string | null;
  /// For display only - see the header. Never used to decide availability.
  eventStatus: string;
  sessionLabel: string | null;
}

/// A VenueUnavailability row - maintenance, renovation and the like.
export interface AvailabilityBlockInput extends Interval {
  id: string;
  reason: string;
  notes: string | null;
}

// ---------------------------------------------------------------------------
// OUTPUT - the response body of GET /api/venues/[id]/availability
// ---------------------------------------------------------------------------

/// What a slot shows, most important first. The first one that applies wins.
///
///   unavailable - a recorded unavailable period covers it (AC4)
///   booked      - an approved booking's own published times cover it (AC3)
///   turnaround  - only a booking's setup or teardown covers it (AC2)
///   closed      - nothing is in it, but the room is shut for the whole slot,
///                 or the venue is retired
///   free        - bookable
///
/// A slot's status never claims two things CLASH - it says what the slot is,
/// and the cell lists everything in it. Clashes are reported on the bookings
/// and blocks themselves, see `overlaps` below.
///
/// Note that under #107 a slot is consumed IN FULL by anything that touches
/// it, so two approved bookings in one slot now ARE a clash, even when their
/// own minutes never meet. That is a change from the earlier model, where
/// slots were treated as wide enough to share.
export type CellStatus = "unavailable" | "booked" | "turnaround" | "closed" | "free";

export interface AvailabilityCell {
  status: CellStatus;
  /// How much of this slot the venue's own opening hours cover. "partial" on an
  /// otherwise free slot means bookable, but not for the whole slot.
  openingHours: OpeningHoursCoverage;
  /// Bookings whose published times fall in this slot.
  bookingIds: string[];
  /// Bookings that reach this slot only through setup or teardown.
  turnaroundBookingIds: string[];
  unavailabilityIds: string[];
}

export interface AvailabilityDay {
  /// Local calendar day, "YYYY-MM-DD".
  date: string;
  slots: Record<Slot, AvailabilityCell>;
}

export interface Overlaps {
  /// Other approved bookings whose occupied time overlaps this one. Should
  /// never happen - but no database constraint prevents it, so it is reported
  /// rather than assumed away.
  bookingIds: string[];
  /// Recorded unavailable periods that overlap this one (AC5).
  unavailabilityIds: string[];
}

export interface AvailabilityBooking {
  id: string;
  eventId: string;
  eventTitle: string | null;
  eventStatus: string;
  sessionLabel: string | null;
  layoutName: string | null;
  startsAt: Date;
  endsAt: Date;
  /// The published times widened by the venue's setup and teardown - how long
  /// the room is actually out of use.
  occupiedFrom: Date;
  occupiedTo: Date;
  /// The day+slot cells this booking touches INSIDE the requested range.
  cells: { day: string; slot: Slot; via: "booking" | "turnaround" }[];
  /// How much of the occupied time falls in no slot at all. Non-zero means the
  /// grid under-reports this booking - worth showing, not hiding.
  minutesOutsideSlots: number;
  overlaps: Overlaps;
}

export interface AvailabilityBlock {
  id: string;
  reason: string;
  notes: string | null;
  startsAt: Date;
  endsAt: Date;
  cells: { day: string; slot: Slot }[];
  overlaps: Overlaps;
}

export interface AvailabilityResponse {
  venue: AvailabilityVenue;
  range: { from: string; to: string; timeZone: string };
  /// The grid's columns, in order, with their labels.
  slots: { slot: Slot; label: string }[];
  days: AvailabilityDay[];
  bookings: AvailabilityBooking[];
  unavailability: AvailabilityBlock[];
  /// True when any booking or unavailable period overlaps another - the one
  /// flag a screen needs to decide whether to show a warning at all.
  hasOverlaps: boolean;
}

// ---------------------------------------------------------------------------
// RANGE
// ---------------------------------------------------------------------------

export type RangeResult = { from: string; to: string } | { error: string };

/// Fill in and check the requested range. `today` is passed in rather than read
/// from the clock so this stays testable. Both inputs are already known to be
/// valid day keys - the query schema checks that.
export function resolveAvailabilityRange(
  requested: { from?: string; to?: string },
  today: string
): RangeResult {
  const from = requested.from ?? today;
  const to = requested.to ?? addDays(from, DEFAULT_AVAILABILITY_DAYS - 1);

  const days = dayRange(from, to).length;
  if (days === 0) {
    return { error: "The end date must be on or after the start date." };
  }
  if (days > MAX_AVAILABILITY_DAYS) {
    return {
      error: `Choose a range of ${MAX_AVAILABILITY_DAYS} days or fewer - this one is ${days}.`,
    };
  }
  return { from, to };
}

// ---------------------------------------------------------------------------
// ASSEMBLY
// ---------------------------------------------------------------------------

/// The overlap test used everywhere in the venues domain: each starts before
/// the other ends (SCHEMA_REFERENCE.md). Half-open, so back-to-back does not
/// count - a booking ending at 12:00 does not clash with one starting at 12:00.
function overlapping(a: Interval, b: Interval): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && a.endsAt.getTime() > b.startsAt.getTime();
}

function emptyCell(openingHours: OpeningHoursCoverage): AvailabilityCell {
  return {
    status: "free",
    openingHours,
    bookingIds: [],
    turnaroundBookingIds: [],
    unavailabilityIds: [],
  };
}

function statusOf(cell: AvailabilityCell, venueActive: boolean): CellStatus {
  if (cell.unavailabilityIds.length > 0) return "unavailable";
  if (cell.bookingIds.length > 0) return "booked";
  if (cell.turnaroundBookingIds.length > 0) return "turnaround";
  // A retired venue must never read as bookable - SPM-39 AC6, "unavailable or
  // inactive venues are not presented as available options". Its bookings and
  // blocks still show above; only the empty slots change. Failing closed here
  // means a screen that forgets to check venue.isActive still cannot offer it.
  if (!venueActive) return "closed";
  if (cell.openingHours === "closed") return "closed";
  return "free";
}

export function buildAvailability(input: {
  venue: AvailabilityVenue;
  from: string;
  to: string;
  timeZone: string;
  bookings: readonly AvailabilityBookingInput[];
  unavailability: readonly AvailabilityBlockInput[];
}): AvailabilityResponse {
  const { venue, from, to, timeZone } = input;
  const inRange = new Set(dayRange(from, to));

  // The grid: every day in range, every slot, starting empty.
  const days: AvailabilityDay[] = dayRange(from, to).map((date) => ({
    date,
    slots: Object.fromEntries(
      SLOTS.map((slot) => [slot, emptyCell(openingHoursCoverage(slot, venue.opensAt, venue.closesAt))])
    ) as Record<Slot, AvailabilityCell>,
  }));
  const cellAt = new Map(days.map((d) => [d.date, d.slots]));

  // Each booking consumes, in full, every slot its own times touch (#107),
  // plus one whole slot of setup before and one of turnaround after (#108,
  // #123). occupiedCells() owns that rule; this only places the result.
  const occupied = input.bookings.map((b) => ({
    booking: b,
    cells: occupiedCells(b, venue),
    window: occupiedWindow(b, venue),
  }));

  const bookings: AvailabilityBooking[] = occupied.map(({ booking, window, cells: all }) => {
    const cells = all.filter((c) => inRange.has(c.day));

    for (const cell of cells) {
      const target = cellAt.get(cell.day)?.[cell.slot];
      if (!target) continue;
      (cell.via === "booking" ? target.bookingIds : target.turnaroundBookingIds).push(booking.id);
    }

    return {
      id: booking.id,
      eventId: booking.eventId,
      eventTitle: booking.eventTitle,
      eventStatus: booking.eventStatus,
      sessionLabel: booking.sessionLabel,
      layoutName: booking.layoutName,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      occupiedFrom: window.startsAt,
      occupiedTo: window.endsAt,
      cells,
      minutesOutsideSlots: hiddenMinutes(booking),
      overlaps: { bookingIds: [], unavailabilityIds: [] },
    };
  });

  const unavailability: AvailabilityBlock[] = input.unavailability.map((block) => {
    const cells = slotsCovered(block)
      .filter((c) => inRange.has(c.day))
      .map((c) => ({ day: c.day, slot: c.slot }));
    for (const cell of cells) {
      cellAt.get(cell.day)?.[cell.slot].unavailabilityIds.push(block.id);
    }
    return {
      id: block.id,
      reason: block.reason,
      notes: block.notes,
      startsAt: block.startsAt,
      endsAt: block.endsAt,
      cells,
      overlaps: { bookingIds: [], unavailabilityIds: [] },
    };
  });

  // AC5, "overlapping unavailable periods are identifiable". Worked out on the
  // REAL intervals - never on slots - and against each booking's occupied
  // window, because maintenance during a booking's setup time is a genuine
  // problem: the room cannot be set up.
  //
  // ⚠️ KNOWN GAP - AC5 IS COVERED BY UNIT TESTS ONLY (2026-09-22).
  // A manual tester cannot exercise this. Nothing in the app can create a
  // VenueUnavailability record: the "Block venue" screen (S-23 in
  // UI_DESIGN.md) is not built, and no route writes to that table. The seed
  // loads five unavailable periods, but they are all at different venues, so
  // none overlap anything - this branch never runs against seeded data.
  // Testing AC5 by hand needs either S-23 or deliberately overlapping rows
  // added to prisma/seed.ts. Deliberately NOT built in SPM-46. See Known Gaps
  // in DOCUMENTATION.md; carry this into SPM-46's test cases as an open
  // question rather than writing a manual case nobody can run.
  for (let i = 0; i < unavailability.length; i++) {
    for (let j = i + 1; j < unavailability.length; j++) {
      if (overlapping(input.unavailability[i], input.unavailability[j])) {
        unavailability[i].overlaps.unavailabilityIds.push(unavailability[j].id);
        unavailability[j].overlaps.unavailabilityIds.push(unavailability[i].id);
      }
    }
    for (let k = 0; k < occupied.length; k++) {
      if (overlapping(input.unavailability[i], occupied[k].window)) {
        unavailability[i].overlaps.bookingIds.push(bookings[k].id);
        bookings[k].overlaps.unavailabilityIds.push(unavailability[i].id);
      }
    }
  }
  for (let i = 0; i < occupied.length; i++) {
    for (let j = i + 1; j < occupied.length; j++) {
      if (overlapping(occupied[i].window, occupied[j].window)) {
        bookings[i].overlaps.bookingIds.push(bookings[j].id);
        bookings[j].overlaps.bookingIds.push(bookings[i].id);
      }
    }
  }

  for (const day of days) {
    for (const slot of SLOTS) {
      day.slots[slot].status = statusOf(day.slots[slot], venue.isActive);
    }
  }

  const hasOverlaps =
    bookings.some((b) => b.overlaps.bookingIds.length + b.overlaps.unavailabilityIds.length > 0) ||
    unavailability.some((u) => u.overlaps.unavailabilityIds.length > 0);

  return {
    venue,
    range: { from, to, timeZone },
    slots: SLOTS.map((slot) => ({ slot, label: slotRangeLabel(slot) })),
    days,
    bookings,
    unavailability,
    hasOverlaps,
  };
}
