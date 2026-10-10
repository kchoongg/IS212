// The availability calendar for one venue over a range of days.
//
// SPM-46 "View Venue Availability", as changed by SPM-93 AC9: "The venue
// availability calendar shows bookings, holds and unavailable periods at their
// actual times, with setup and turnaround shown separately from the booked
// time." Each day is a list of timed entries, not three AM / PM / Night cells.
//
// The route in src/app/api/venues/[id]/availability/route.ts loads the rows and
// calls buildAvailability(); everything that decides what the calendar SAYS
// lives here, as pure functions over plain data - no Prisma, no NextRequest -
// so the rules can be tested without a database.
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
  addDays,
  asClock,
  dayRange,
  occupiedWindow,
  overlapping,
  partOnDay,
  type Interval,
} from "@/lib/venueTime";

/// The longest range one request may cover. A calendar is read a week or a
/// month at a time; this stops a single request asking for years of entries.
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

/// An APPROVED booking. The route only ever passes approved ones.
export interface AvailabilityBookingInput extends Interval {
  id: string;
  layoutName: string | null;
  eventId: string;
  eventTitle: string | null;
  /// For display only - see the header. Never used to decide availability.
  eventStatus: string;
  sessionLabel: string | null;
}

/// A PENDING booking request - a tentative hold (#41).
export interface AvailabilityHoldInput extends Interval {
  id: string;
  eventId: string;
  eventTitle: string | null;
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

/// What one entry on a day's row is:
///
///   setup       - the venue's setup time before a booking or hold
///   booked      - an approved booking's own times (AC3)
///   requested   - a pending request's own times - a tentative hold (#41).
///                 Shown so a coordinator can see the room has already been
///                 asked for; booking requests treat it as taken (SPM-42).
///   turnaround  - the venue's turnaround time after a booking or hold
///   unavailable - a recorded unavailable period (AC4)
///
/// Setup and turnaround are their own entries, never folded into the booked
/// time (SPM-93 AC9).
export type EntryKind = "setup" | "booked" | "requested" | "turnaround" | "unavailable";

export interface ScheduleEntry {
  kind: EntryKind;
  /// Wall-clock "HH:MM" on this row's day. `to` is "24:00" for a period that
  /// runs past midnight, which then continues on the next day's row from "00:00".
  from: string;
  to: string;
  /// The event's title, or the unavailable period's reason in words.
  label: string;
  bookingId?: string;
  holdId?: string;
  unavailabilityId?: string;
}

export interface AvailabilityDay {
  /// Local calendar day, "YYYY-MM-DD".
  date: string;
  /// In time order. Empty means nothing is on: the room is free, or - for a
  /// retired venue - closed.
  entries: ScheduleEntry[];
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
  /// The booked times widened by the venue's setup and turnaround - how long
  /// the room is actually out of use (SPM-93 AC6).
  occupiedFrom: Date;
  occupiedTo: Date;
  overlaps: Overlaps;
}

export interface AvailabilityHold extends AvailabilityHoldInput {
  occupiedFrom: Date;
  occupiedTo: Date;
}

export interface AvailabilityBlock {
  id: string;
  reason: string;
  notes: string | null;
  startsAt: Date;
  endsAt: Date;
  overlaps: Overlaps;
}

export interface AvailabilityResponse {
  venue: AvailabilityVenue;
  range: { from: string; to: string; timeZone: string };
  days: AvailabilityDay[];
  bookings: AvailabilityBooking[];
  unavailability: AvailabilityBlock[];
  /// Pending requests in range - tentative holds.
  holds: AvailabilityHold[];
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

/// "renovation" -> "Renovation", "internal_activity" -> "Internal activity".
export function reasonLabel(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/// At the same start minute, an earlier booking's turnaround is listed before a
/// later one's setup - the order things happen in the room.
const KIND_ORDER: Record<EntryKind, number> = {
  turnaround: 0,
  unavailable: 1,
  setup: 2,
  booked: 3,
  requested: 3,
};

type Placed = { entry: ScheduleEntry; fromMinute: number };

export function buildAvailability(input: {
  venue: AvailabilityVenue;
  from: string;
  to: string;
  timeZone: string;
  bookings: readonly AvailabilityBookingInput[];
  unavailability: readonly AvailabilityBlockInput[];
  holds?: readonly AvailabilityHoldInput[];
}): AvailabilityResponse {
  const { venue, from, to, timeZone } = input;
  const dates = dayRange(from, to);
  const placed = new Map<string, Placed[]>(dates.map((d) => [d, []]));

  /// Put one period on every day of the range it touches, clipped to each day.
  function place(period: Interval, entry: Omit<ScheduleEntry, "from" | "to">) {
    if (period.endsAt.getTime() <= period.startsAt.getTime()) return;
    for (const date of dates) {
      const part = partOnDay(period, date);
      if (!part) continue;
      placed.get(date)!.push({ entry: { ...entry, from: asClock(part.from), to: asClock(part.to) }, fromMinute: part.from });
    }
  }

  /// A booking or hold: setup, its own time, turnaround - three entries.
  function placeWithTurnaround(
    period: Interval,
    kind: "booked" | "requested",
    label: string,
    ids: Pick<ScheduleEntry, "bookingId" | "holdId">
  ): Interval {
    const occupied = occupiedWindow(period, venue);
    place({ startsAt: occupied.startsAt, endsAt: period.startsAt }, { kind: "setup", label, ...ids });
    place(period, { kind, label, ...ids });
    place({ startsAt: period.endsAt, endsAt: occupied.endsAt }, { kind: "turnaround", label, ...ids });
    return occupied;
  }

  const occupied = input.bookings.map((b) =>
    placeWithTurnaround(b, "booked", b.eventTitle ?? "Untitled event", { bookingId: b.id })
  );

  const bookings: AvailabilityBooking[] = input.bookings.map((booking, i) => ({
    id: booking.id,
    eventId: booking.eventId,
    eventTitle: booking.eventTitle,
    eventStatus: booking.eventStatus,
    sessionLabel: booking.sessionLabel,
    layoutName: booking.layoutName,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    occupiedFrom: occupied[i].startsAt,
    occupiedTo: occupied[i].endsAt,
    overlaps: { bookingIds: [], unavailabilityIds: [] },
  }));

  const unavailability: AvailabilityBlock[] = input.unavailability.map((block) => {
    place(block, { kind: "unavailable", label: reasonLabel(block.reason), unavailabilityId: block.id });
    return {
      id: block.id,
      reason: block.reason,
      notes: block.notes,
      startsAt: block.startsAt,
      endsAt: block.endsAt,
      overlaps: { bookingIds: [], unavailabilityIds: [] },
    };
  });

  const holds: AvailabilityHold[] = (input.holds ?? []).map((hold) => {
    const window = placeWithTurnaround(hold, "requested", hold.eventTitle ?? "Untitled event", { holdId: hold.id });
    return { ...hold, occupiedFrom: window.startsAt, occupiedTo: window.endsAt };
  });

  // AC5, "overlapping unavailable periods are identifiable". Worked out on the
  // real intervals, and against each booking's occupied window, because
  // maintenance during a booking's setup time is a genuine problem: the room
  // cannot be set up. Holds are not clashes - a request is not a commitment.
  //
  // Overlapping periods used to exist only in the seed. Since SPM-45 Venue
  // Staff can record them in the app (SPM-45-TC18 does), so this runs against
  // real data too.
  for (let i = 0; i < unavailability.length; i++) {
    for (let j = i + 1; j < unavailability.length; j++) {
      if (overlapping(input.unavailability[i], input.unavailability[j])) {
        unavailability[i].overlaps.unavailabilityIds.push(unavailability[j].id);
        unavailability[j].overlaps.unavailabilityIds.push(unavailability[i].id);
      }
    }
    for (let k = 0; k < occupied.length; k++) {
      if (overlapping(input.unavailability[i], occupied[k])) {
        unavailability[i].overlaps.bookingIds.push(bookings[k].id);
        bookings[k].overlaps.unavailabilityIds.push(unavailability[i].id);
      }
    }
  }
  for (let i = 0; i < occupied.length; i++) {
    for (let j = i + 1; j < occupied.length; j++) {
      if (overlapping(occupied[i], occupied[j])) {
        bookings[i].overlaps.bookingIds.push(bookings[j].id);
        bookings[j].overlaps.bookingIds.push(bookings[i].id);
      }
    }
  }

  const hasOverlaps =
    bookings.some((b) => b.overlaps.bookingIds.length + b.overlaps.unavailabilityIds.length > 0) ||
    unavailability.some((u) => u.overlaps.unavailabilityIds.length > 0);

  const days: AvailabilityDay[] = dates.map((date) => ({
    date,
    entries: placed
      .get(date)!
      .sort((a, b) => a.fromMinute - b.fromMinute || KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind])
      .map((p) => p.entry),
  }));

  return {
    venue,
    range: { from, to, timeZone },
    days,
    bookings,
    unavailability,
    holds,
    hasOverlaps,
  };
}
