// Booking Conflict Detection (SPM-44), in times since SPM-93.
//
// SPM-42 already refused a clashing request, but it answered only "booked",
// "on_hold" or "unavailable" — enough to stop the write, not enough to tell
// the coordinator what to do next (AC9). This module is the one place that
// decides whether a window clashes, what it clashes WITH, and how to say so.
//
// Two callers, two rules, deliberately separate:
//
//   request time  (AC5) — an approved booking OR another pending request
//                         blocks, because only one active hold may exist for
//                         a venue and overlapping time period (#41).
//   confirm time  (AC6) — only an approved booking blocks. Two pending
//                         requests may both exist; approving one is exactly
//                         how Venue Staff choose between them, so a pending
//                         sibling must not stand in the way.
//
// SPM-93 (Week 7 Change #1, #126, #128) changed what "overlap" means: no more
// AM / PM / Night slots. A booking - approved or pending - occupies the room
// from its start minus the venue's setup to its end plus its turnaround
// (occupiedWindow(), src/lib/venueTime.ts), and two bookings clash when those
// periods overlap. Periods that only meet end to start do not.
//
// Pure functions over plain data, like the rest of src/lib — no Prisma here,
// so every rule below is unit tested against object literals.

import { formatDateTimeRange } from "@/lib/format";
import { occupiedWindow, overlapping, type Interval, type Turnaround } from "@/lib/venueTime";
import type { SearchBlock, SearchBooking } from "@/lib/venueSearch";

/// Exactly what deciding a conflict reads - no more. Narrower than
/// SearchableVenue (which a venue search also needs for layouts, facilities
/// and opening hours) so that the booking REVIEW side, whose venue shape is
/// its own, can call the same rule instead of keeping a second copy of it.
/// SearchableVenue satisfies this structurally, so its callers are unaffected.
export interface ConflictVenue extends Turnaround {
  name: string;
  bookings: readonly SearchBooking[];
  unavailability: readonly SearchBlock[];
}

export type ConflictKind = "unavailable" | "booked" | "on_hold";

export interface VenueConflict {
  kind: ConflictKind;
  /// The time the two parties actually both need. This is what makes the
  /// refusal specific: a clash through setup alone names those minutes, not
  /// the times the coordinator asked for.
  shared: Interval;
  /// Set when kind is "booked" or "on_hold".
  booking?: SearchBooking;
  /// Set when kind is "unavailable".
  block?: SearchBlock;
}

/// Which existing bookings are allowed to block.
///
///   "active"   — approved and pending (a new request, AC4/AC5)
///   "approved" — approved only (confirming one, AC6)
export type ConflictScope = "active" | "approved";

export interface FindConflictOptions {
  /// The event being requested or confirmed. Its own bookings never conflict
  /// with themselves — one session's turnaround must not shut the event's next
  /// session out of the same room. The event asking for a room it already
  /// holds at that time is a different problem (a duplicate), checked by
  /// findDuplicateRequest() below.
  eventId?: string;
  /// A booking being confirmed does not conflict with itself.
  bookingId?: string;
  scope?: ConflictScope;
}

/// AC7: a rejected or cancelled booking holds nothing. The customer's
/// "withdrawn" and "released" are both stored as `cancelled` — see
/// VenueBooking.status in prisma/schema.prisma.
const BLOCKING_STATUSES: Record<ConflictScope, readonly string[]> = {
  active: ["approved", "pending"],
  approved: ["approved"],
};

/// The part of time two overlapping periods share.
function sharedPeriod(a: Interval, b: Interval): Interval {
  return {
    startsAt: new Date(Math.max(a.startsAt.getTime(), b.startsAt.getTime())),
    endsAt: new Date(Math.min(a.endsAt.getTime(), b.endsAt.getTime())),
  };
}

/// The first thing stopping `window` at this venue, or null when nothing does
/// (AC10 — a non-overlapping booking is simply allowed).
///
/// Order matters: unavailability is reported before a booking, because a room
/// closed for maintenance cannot be freed by moving one event; and an approved
/// booking before a pending one, because it is the firmer commitment.
export function findVenueConflict(
  venue: ConflictVenue,
  window: Interval,
  options: FindConflictOptions = {}
): VenueConflict | null {
  const { eventId, bookingId, scope = "active" } = options;

  // AC2, SPM-93 AC6: the request needs its own times plus the venue's setup
  // and turnaround, so a clash can be through minutes the coordinator never
  // asked for.
  const needed = occupiedWindow(window, venue);

  // AC8 — a blocked venue is a conflict like any other.
  const block = venue.unavailability.find((u) => overlapping(needed, u));
  if (block) {
    return { kind: "unavailable", block, shared: sharedPeriod(needed, block) };
  }

  const candidates = venue.bookings.filter(
    (b) =>
      (eventId == null || b.eventId !== eventId) &&
      (bookingId == null || b.id !== bookingId) &&
      BLOCKING_STATUSES[scope].includes(b.status)
  );

  // SPM-93: an approved booking AND a pending request (a tentative hold) each
  // take their setup and turnaround with them. #41 allows one hold or booking
  // per "overlapping time period", and Week 7 Change #1 puts setup and
  // turnaround into every availability check (decided 2026-10-08; before
  // SPM-93 a hold held only the slots asked for).
  const clashWith = (status: string) =>
    candidates.find((b) => b.status === status && overlapping(needed, occupiedWindow(b, venue)));

  const booked = clashWith("approved");
  if (booked) {
    return { kind: "booked", booking: booked, shared: sharedPeriod(needed, occupiedWindow(booked, venue)) };
  }

  const held = clashWith("pending");
  if (held) {
    return { kind: "on_hold", booking: held, shared: sharedPeriod(needed, occupiedWindow(held, venue)) };
  }

  return null;
}

/// Who a request is for: the event, and the session when it has sessions.
export interface RequestHolder {
  eventId: string;
  /// Null for an event without sessions. Not part of the rule since SPM-81;
  /// the caller uses it to word the refusal.
  sessionId: string | null;
}

/// AC4's other half: "only one active pending request or confirmed booking
/// may exist for the same venue and slot" - including from the same event.
/// findVenueConflict() exempts the event's own bookings, so on its own it let
/// a coordinator submit the same request twice and get two pending rows
/// (raised in review on PR #37).
///
/// A repeat is the same EVENT at this venue, overlapping the times asked for,
/// while the first request is still pending or approved - whichever of its
/// sessions asks (SPM-81 AC4, decided 2026-10-10: "the same venue cannot be
/// requested twice for the same event for overlapping times"). Before SPM-81
/// it had to be the same session too, so two sessions could hold one room at
/// the same time.
///
/// Only the times each request holds are compared: setup and turnaround are
/// about one event making way for another, and here there is only one. So a
/// session that starts as another ends may follow it in the same room.
export function findDuplicateRequest(
  venue: ConflictVenue,
  window: Interval,
  holder: RequestHolder
): SearchBooking | null {
  return (
    venue.bookings.find(
      (b) =>
        b.eventId === holder.eventId &&
        BLOCKING_STATUSES.active.includes(b.status) &&
        overlapping(window, b)
    ) ?? null
  );
}

/// AC9: say what is in the way, not merely that something is.
///
/// Every reader of this message is internal staff who can already open the
/// other event, so naming it costs no privacy and saves a trip to the
/// calendar. A booking whose event we could not label still gets its period.
///
///   "SPM93 Studio is already booked for EVT-000123 SPM93 Morning Masterclass on 8 Jun 2027, 09:30–09:45."
///   "SPM93 Studio is unavailable at this time (maintenance, 16 Jun 2027, 14:00–18:00)."
export function describeVenueConflict(venueName: string, conflict: VenueConflict): string {
  const when = formatDateTimeRange(conflict.shared.startsAt, conflict.shared.endsAt);

  if (conflict.kind === "unavailable") {
    const reason = conflict.block?.reason?.replace(/_/g, " ");
    // The room's whole closure, not just the minutes asked for: a coordinator
    // looking for another time needs to know how long it is out.
    const period = conflict.block ? formatDateTimeRange(conflict.block.startsAt, conflict.block.endsAt) : when;
    const detail = [reason, period].filter(Boolean).join(", ");
    return `${venueName} is unavailable at this time (${detail}).`;
  }

  const event = describeBookingEvent(conflict.booking);
  const verb = conflict.kind === "booked" ? "is already booked" : "is on hold";
  const forWhom = event ? ` for ${event}` : conflict.kind === "booked" ? "" : " for another event";

  return `${venueName} ${verb}${forWhom} on ${when}.`;
}

function describeBookingEvent(booking?: SearchBooking): string | null {
  if (!booking) return null;
  const parts = [booking.eventReference, booking.eventTitle].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}
