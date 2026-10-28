// Cancel Event (SPM-37). The assigned Coordinator cancels an event that has not
// been completed (AC1, AC2, #68 "any stage"), and everything it holds is let go
// in the same transaction (PATCH /api/events/[id]):
//
//   an Approved booking     -> released   (AC3; Venue Staff are told, as SPM-67)
//   a Pending request       -> withdrawn  (AC4; it leaves Booking Requests)
//   every equipment line    -> cancelled  (AC3; reserved or not)
//   a pending change request -> withdrawn (AC5; nothing it proposes is applied)
//   a pending or approved safety check -> closed (AC6)
//
// Registrations are kept as they are (AC7, SPM-52: a cancelled event's history
// does not change); nobody can register, because only Confirmed events take
// registrations. Nothing moves out of Cancelled (AC9, canTransition()).
//
// The Cancel event dialog lists what will be let go before the Coordinator
// confirms (UI_DESIGN.md §7.4, §7.5) - cancellationConsequences() below, served
// by GET /api/events/[id]/cancellation. Pure functions, like the rest of src/lib.

import { formatDateTimeRange, formatVenue } from "./format";

export const EVENT_CANCELLED_MESSAGE =
  "The event has been cancelled. Its venue bookings and equipment have been released.";
/// Shown on a cancelled event's Overview when the reason was left empty (AC8).
export const NO_CANCELLATION_REASON = "No reason was recorded.";
/// The dialog, when cancelling lets go of nothing.
export const NOTHING_TO_RELEASE = "This event has no venue bookings, equipment or registration to release.";
/// EventChangeRequest.reviewNotes on a change request the cancellation closed (AC5).
export const CHANGE_REQUEST_CLOSED_NOTE = "Closed because the event was cancelled.";
/// SPM-32: reviewNotes on the organiser's cancellation request that cancelling
/// the event carries out - approved, not closed.
export const CANCELLATION_REQUEST_APPROVED_NOTE = "Approved: the event was cancelled.";
/// SafetyCheck.decisionNote on a check the cancellation closed (AC6).
export const SAFETY_CHECK_CLOSED_NOTE = "Event cancelled";

/// The reason stored on each booking the cancellation released or withdrew,
/// shown on the Venue tab as "Reason for release: ..." (AC8).
export function arrangementCancellationNote(reason: string | null | undefined): string {
  const trimmed = reason?.trim();
  return trimmed ? `Event cancelled: ${trimmed}` : "Event cancelled.";
}

export interface CancellationBooking {
  status: string;
  startsAt: Date | string;
  endsAt: Date | string;
  venue: { name: string; code: string };
  session?: { label: string | null } | null;
}

export interface CancellationEquipment {
  status: string;
  quantityRequested: number;
  quantityReserved: number | null;
  equipment: { name: string };
}

export interface CancellationInput {
  bookings: CancellationBooking[];
  equipment: CancellationEquipment[];
  /// Pending change requests other than a cancellation request - closed.
  pendingChangeRequests: number;
  /// SPM-32: pending cancellation requests - approved by the cancellation.
  pendingCancellationRequests?: number;
  safetyCheckPending: boolean;
  registration: { enabled: boolean; registered: number; waitlisted: number };
}

/// Equipment lines that hold stock for the event (SPM-49).
const HOLDING_STOCK = ["reserved", "partially_fulfilled"];

function describeBooking(b: CancellationBooking): string {
  const session = b.session ? ` for ${b.session.label ?? "Session"}` : "";
  return `${formatVenue(b.venue.name, b.venue.code)}${session} on ${formatDateTimeRange(b.startsAt, b.endsAt)}`;
}

/// The bookings and equipment lines of the dialog, in its order. Shared with
/// Postpone Event (SPM-38), which lets go of the same arrangements.
export function arrangementConsequences(input: Pick<CancellationInput, "bookings" | "equipment">): string[] {
  const lines: string[] = [];

  for (const b of input.bookings.filter((b) => b.status === "approved")) lines.push(`Release ${describeBooking(b)}`);
  for (const b of input.bookings.filter((b) => b.status === "pending")) {
    lines.push(`Withdraw the request for ${describeBooking(b)}`);
  }

  const live = input.equipment.filter((e) => e.status !== "cancelled");
  for (const e of live.filter((e) => HOLDING_STOCK.includes(e.status))) {
    lines.push(`Release ${e.quantityReserved ?? e.quantityRequested} × ${e.equipment.name}`);
  }
  for (const e of live.filter((e) => !HOLDING_STOCK.includes(e.status))) {
    lines.push(`Cancel the request for ${e.quantityRequested} × ${e.equipment.name}`);
  }
  return lines;
}

/// What cancelling will let go, one line each, in the dialog's order: bookings
/// first and registration last. Empty when there is nothing.
export function cancellationConsequences(input: CancellationInput): string[] {
  const lines = arrangementConsequences(input);

  const asked = input.pendingCancellationRequests ?? 0;
  if (asked > 0) lines.push(`Approve ${asked} cancellation request${asked === 1 ? "" : "s"}`);
  const changes = input.pendingChangeRequests;
  if (changes > 0) lines.push(`Close ${changes} pending change request${changes === 1 ? "" : "s"}`);
  if (input.safetyCheckPending) lines.push("Close the pending safety check");

  const { enabled, registered, waitlisted } = input.registration;
  if (enabled) lines.push(`Close registration: ${registered} registered, ${waitlisted} on the waiting list`);

  return lines;
}
