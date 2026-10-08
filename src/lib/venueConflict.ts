// Booking Conflict Detection (SPM-44).
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
//                         a venue and slot (#41).
//   confirm time  (AC6) — only an approved booking blocks. Two pending
//                         requests may both exist; approving one is exactly
//                         how Venue Staff choose between them, so a pending
//                         sibling must not stand in the way.
//
// Pure functions over plain data, like the rest of src/lib — no Prisma here,
// so every rule below is unit tested against object literals.

import { formatDate } from "@/lib/format";
import {
  NO_TURNAROUND,
  localDayStart,
  occupiedWindow,
  overlapping,
  slotsCovered,
  type Interval,
  type SlotCell,
  type Turnaround,
} from "@/lib/venueSlots";
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
  /// The day+slot cells the two parties actually share. This is what makes the
  /// refusal specific: a clash through setup alone names the setup slot, not
  /// the slots the coordinator picked.
  cells: SlotCell[];
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
  /// with themselves — two sessions of one event may share a room in the same
  /// slot. Asking twice for the same thing is a different problem (a
  /// duplicate), checked by findDuplicateRequest() below.
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

/// The cells two intervals share, in order. Empty when they do not overlap.
function sharedCells(a: Interval, b: Interval): SlotCell[] {
  const bKeys = new Set(slotsCovered(b).map((c) => `${c.day}|${c.slot}`));
  return slotsCovered(a).filter((c) => bKeys.has(`${c.day}|${c.slot}`));
}

/// The first thing stopping `window` at this venue, or null when nothing does
/// (AC10 — a non-overlapping booking is simply allowed).
///
/// Order matters: unavailability is reported before a booking, because a room
/// closed for maintenance cannot be freed by moving one event.
export function findVenueConflict(
  venue: ConflictVenue,
  window: Interval,
  options: FindConflictOptions = {}
): VenueConflict | null {
  const { eventId, bookingId, scope = "active" } = options;

  // AC2: the request holds its own slots plus the venue's setup and
  // turnaround, so a clash can be through a slot the coordinator never ticked.
  const needed = occupiedWindow(window, venue);

  // AC8 — a blocked venue is a conflict like any other.
  const block = venue.unavailability.find((u) => overlapping(needed, u));
  if (block) {
    return { kind: "unavailable", block, cells: sharedCells(needed, block) };
  }

  const candidates = venue.bookings.filter(
    (b) =>
      (eventId == null || b.eventId !== eventId) &&
      (bookingId == null || b.id !== bookingId) &&
      BLOCKING_STATUSES[scope].includes(b.status)
  );

  // An approved booking takes its setup and turnaround with it; a pending one
  // holds only the slots asked for, because it is not yet a commitment to
  // prepare the room (#41).
  const booked = candidates.find(
    (b) => b.status === "approved" && overlapping(needed, occupiedWindow(b, venue))
  );
  if (booked) {
    return { kind: "booked", booking: booked, cells: sharedCells(needed, occupiedWindow(booked, venue)) };
  }

  const held = candidates.find(
    (b) => b.status === "pending" && overlapping(needed, occupiedWindow(b, NO_TURNAROUND))
  );
  if (held) {
    return { kind: "on_hold", booking: held, cells: sharedCells(needed, occupiedWindow(held, NO_TURNAROUND)) };
  }

  return null;
}

/// Who a request is for: the event, and the session when it has sessions.
export interface RequestHolder {
  eventId: string;
  /// Null for an event without sessions.
  sessionId: string | null;
}

/// AC4's other half: "only one active pending request or confirmed booking
/// may exist for the same venue and slot" - including from the same event.
/// findVenueConflict() exempts the event's own bookings, so on its own it let
/// a coordinator submit the same request twice and get two pending rows
/// (raised in review on PR #37).
///
/// A repeat is the same holder - same event, same session or both none - at
/// this venue, overlapping the slots asked for, while the first request is
/// still pending or approved. Two DIFFERENT sessions of one event sharing a
/// room is allowed, which is why the exemption above stays.
///
/// Only the slots each request holds are compared: setup and turnaround are
/// about one event making way for another, and here there is only one.
export function findDuplicateRequest(
  venue: ConflictVenue,
  window: Interval,
  holder: RequestHolder
): SearchBooking | null {
  return (
    venue.bookings.find(
      (b) =>
        b.eventId === holder.eventId &&
        (b.sessionId ?? null) === holder.sessionId &&
        BLOCKING_STATUSES.active.includes(b.status) &&
        overlapping(window, b)
    ) ?? null
  );
}

/// "21 Oct 2026, AM" · "21 Oct 2026, AM–PM" · "5 Mar 2027 Night – 6 Mar 2027 AM".
///
/// The slot is kept even when the span crosses days, because that is exactly
/// the case where it is doing the most work: a clash reaching from one day's
/// Night into the next day's AM is the setup rule (#123) at work, and a
/// date-only label would leave the coordinator thinking both whole days are
/// gone.
function cellsLabel(cells: readonly SlotCell[]): string | null {
  if (cells.length === 0) return null;
  const first = cells[0];
  const last = cells[cells.length - 1];
  const day = (c: SlotCell) => formatDate(localDayStart(c.day));

  if (first.day === last.day) {
    const span = first.slot === last.slot ? first.slot : `${first.slot}–${last.slot}`;
    return `${day(first)}, ${span}`;
  }
  return `${day(first)} ${first.slot} – ${day(last)} ${last.slot}`;
}

/// AC9: say what is in the way, not merely that something is.
///
/// Every reader of this message is internal staff who can already open the
/// other event, so naming it costs no privacy and saves a trip to the
/// calendar. A booking whose event we could not label still gets its period.
export function describeVenueConflict(venueName: string, conflict: VenueConflict): string {
  const when = cellsLabel(conflict.cells);

  if (conflict.kind === "unavailable") {
    const reason = conflict.block?.reason?.replace(/_/g, " ");
    // The room's whole closure, not just the slot asked for: a coordinator
    // looking for another date needs to know how long it is out, and the
    // contested slot alone would imply it reopens the next morning.
    const period = conflict.block ? cellsLabel(slotsCovered(conflict.block)) : when;
    const detail = [reason, period].filter(Boolean).join(", ");
    return detail
      ? `${venueName} is unavailable at this time (${detail}).`
      : `${venueName} is unavailable at this time.`;
  }

  const event = describeBookingEvent(conflict.booking);
  const verb = conflict.kind === "booked" ? "is already booked" : "is on hold";
  const forWhom = event ? ` for ${event}` : conflict.kind === "booked" ? "" : " for another event";
  const period = when ? ` on ${when}` : "";

  return `${venueName} ${verb}${forWhom}${period}.`;
}

function describeBookingEvent(booking?: SearchBooking): string | null {
  if (!booking) return null;
  const parts = [booking.eventReference, booking.eventTitle].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}
