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

/// AC1, AC7: a pending or confirmed booking that has not finished. `endsAt`,
/// not `startsAt`, as every venue flag does: a booking under way still has its
/// turnaround ahead of it.
export function isRecheckCandidate(booking: { status: string; endsAt: Date }, now: Date): boolean {
  return (
    (RECHECK_STATUSES as readonly string[]).includes(booking.status) && booking.endsAt.getTime() > now.getTime()
  );
}

/// isRecheckCandidate() as a Prisma `where`. Keep the two in step.
export function recheckCandidateWhere(now: Date) {
  return { status: { in: [...RECHECK_STATUSES] }, endsAt: { gt: now } };
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
export function recheckBookings<B extends RecheckBooking, P extends Interval>(
  before: Turnaround,
  after: Turnaround,
  bookings: readonly B[],
  unavailable: readonly P[]
): RecheckFinding<P>[] {
  const findings: RecheckFinding<P>[] = [];
  for (const booking of bookings) {
    const was = occupiedWindow(booking, before);
    const now = occupiedWindow(booking, after);

    const clashesWith = bookings
      .filter(
        (other) =>
          other.eventId !== booking.eventId &&
          overlapping(now, occupiedWindow(other, after)) &&
          !overlapping(was, occupiedWindow(other, before))
      )
      .map((other) => other.id);
    const unavailableDuring = unavailable.filter((period) => overlapping(now, period) && !overlapping(was, period));

    const reasons: ImpactReason[] = [];
    if (clashesWith.length > 0) reasons.push("booking_clash");
    if (unavailableDuring.length > 0) reasons.push("venue_unavailable");
    if (reasons.length > 0) {
      findings.push({ bookingId: booking.id, reasons, clashesWith, unavailableDuring });
    }
  }
  return findings;
}
