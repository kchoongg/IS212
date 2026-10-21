// Re-check Bookings When Setup or Turnaround Time Changes (SPM-80).
//
// Week 7 Customer Changes, Change #1: each venue's setup and turnaround time
// "must be included when checking availability and detecting booking
// conflicts... Existing bookings that become problematic under the new rule
// should be identified rather than silently removed." SPM-93 put the times into
// every check of a NEW request (occupiedWindow(), src/lib/venueTime.ts) - which
// reads the venue as it is, so a request made after a change is already checked
// with the new times (AC8). This module is the other half: the bookings the
// venue already has, re-checked when Venue Staff change either time.
//
// What the re-check flags (decided 2026-10-20):
//   booking_clash      two bookings of different events whose occupied periods
//                      overlap under the new times (AC2). Both are flagged and
//                      each names the other. One event's own bookings never
//                      clash, as in findVenueConflict(): a session's turnaround
//                      must not flag the same event's next session.
//   venue_unavailable  a booking whose occupied period now overlaps a recorded
//                      unavailable period (AC3) - the code SPM-45 uses when a
//                      period is recorded over a booking.
// Only what the change NEWLY breaks, like every other venue edit
// (venueImpact.ts): a clash or overlap that was already there under the old
// times was refused or flagged when it arose, and saving twice flags once.
//
// Nothing here changes a booking (AC4). PURE functions over plain data, like
// the rest of src/lib; PATCH /api/venues/[id] loads the rows and writes the
// flags and notifications.

import type { ImpactReason } from "@/lib/venueImpact";
import { occupiedWindow, overlapping, type Interval, type Turnaround } from "@/lib/venueTime";

/// AC1: pending requests and confirmed bookings - the two statuses that hold
/// the venue (VenueBooking.status in prisma/schema.prisma).
export const RECHECK_STATUSES = ["pending", "approved"] as const;

/// AC1, AC7: the bookings to load, as a Prisma `where` - pending and confirmed
/// ones whose room-in-use time under the NEW turnaround has not ended. That
/// includes one that finished a few minutes ago but whose turnaround still
/// holds the room: it is not flagged itself (recheckBookings() takes `now`),
/// but the booking after it must be, naming it (review of PR #74).
export function recheckCandidateWhere(now: Date, after: Turnaround) {
  return {
    status: { in: [...RECHECK_STATUSES] },
    endsAt: { gt: new Date(now.getTime() - after.teardownMinutes * 60_000) },
  };
}

/// AC1: "is changed" - saving the same times again re-checks nothing.
export function turnaroundChanged(before: Turnaround, after: Turnaround): boolean {
  return before.setupMinutes !== after.setupMinutes || before.teardownMinutes !== after.teardownMinutes;
}

/// AC5: the change, for the notification - "the setup time changed from 0 to
/// 30 minutes". `teardownMinutes` is the customer's turnaround time.
export function turnaroundChangeSentence(before: Turnaround, after: Turnaround): string {
  const parts: string[] = [];
  if (before.setupMinutes !== after.setupMinutes) {
    parts.push(`the setup time changed from ${before.setupMinutes} to ${after.setupMinutes} minutes`);
  }
  if (before.teardownMinutes !== after.teardownMinutes) {
    parts.push(`the turnaround time changed from ${before.teardownMinutes} to ${after.teardownMinutes} minutes`);
  }
  return parts.join(" and ");
}

export interface RecheckBooking extends Interval {
  id: string;
  eventId: string;
}

export interface RecheckFinding<P extends Interval = Interval> {
  bookingId: string;
  reasons: ImpactReason[];
  /// AC2: the ids of the bookings this one now clashes with, in input order.
  clashesWith: string[];
  /// AC3: the unavailable periods this one now overlaps, as they were passed in.
  unavailableDuring: P[];
}

/// Every booking the change newly puts in conflict, in input order. Bookings
/// with nothing new are left out (AC6), so the result is exactly what to flag.
///
/// With `now`, a booking that ended before it is only ever the other side of a
/// clash: nobody can act on a booking whose event is over (AC7).
export function recheckBookings<B extends RecheckBooking, P extends Interval>(
  before: Turnaround,
  after: Turnaround,
  bookings: readonly B[],
  unavailable: readonly P[],
  now?: Date
): RecheckFinding<P>[] {
  // Each booking's room-in-use time, worked out once rather than per pair.
  const windows = bookings.map((booking) => ({
    booking,
    was: occupiedWindow(booking, before),
    is: occupiedWindow(booking, after),
  }));

  const findings: RecheckFinding<P>[] = [];
  for (const { booking, was, is } of windows) {
    if (now && booking.endsAt.getTime() <= now.getTime()) continue;

    const clashesWith = windows
      .filter(
        (other) =>
          other.booking.eventId !== booking.eventId && overlapping(is, other.is) && !overlapping(was, other.was)
      )
      .map((other) => other.booking.id);
    const unavailableDuring = unavailable.filter((period) => overlapping(is, period) && !overlapping(was, period));

    const reasons: ImpactReason[] = [];
    if (clashesWith.length > 0) reasons.push("booking_clash");
    if (unavailableDuring.length > 0) reasons.push("venue_unavailable");
    if (reasons.length > 0) {
      findings.push({ bookingId: booking.id, reasons, clashesWith, unavailableDuring });
    }
  }
  return findings;
}
