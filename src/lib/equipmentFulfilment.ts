// SPM-50 — Review and Update Equipment Request. "As Technical Support Staff, I
// want to review and update equipment requests so that equipment arrangements
// accurately reflect what can be provided."
//
// The rules for Technical Support's per-line update (fulfilment status +
// technical notes), kept out of the route so they can be tested. Decisions
// behind them are in docs/test-cases/SPM-50_test_cases.json (open questions):
//
//  * "Reserved" and "Partially fulfilled" say stock is held, so only the
//    Reserve button (SPM-49), which checks availability, sets them - never a
//    hand-picked status. That keeps quantityReserved = min(requested,
//    available) true on every line.
//  * Leaving "Reserved" / "Partially fulfilled" releases stock, so it only
//    goes through "Unavailable" (with a reason) - not a quiet move back to
//    "Requested" or "Under review".
//  * "Unavailable" needs a reason the Coordinator can act on (customer Q&A
//    #90: highlight unavailable items or suggest alternatives).
//  * Technical notes are capped at 500 characters, matching the
//    out-of-service reason (SPM-55, recordOutOfServiceSchema).
//
// Marking a line "Unavailable" frees its stock by the status change alone:
// committedQuantity() (equipmentAvailability.ts) only counts reserved /
// partially_fulfilled lines. quantityReserved is cleared as well, purely so no
// row reads "unavailable, 1 reserved".

import { eventAllowsReserving, reservingClosedMessage } from "@/lib/equipmentAvailability";

/// Statuses Technical Support can pick by hand.
export const HAND_PICKED_STATUSES = ["requested", "under_review", "unavailable"];

/// Statuses that hold stock - set only by reserving.
const HOLDING_STATUSES = ["reserved", "partially_fulfilled"];

export const STAFF_NOTES_MAX_LENGTH = 500;

/// Updates follow the same rule as reserving - Technical Support works on an
/// event's equipment while it is in Planning (BPMN: "Check equipment
/// availability" / "Reserve equipment"). See eventAllowsReserving().
export function eventAllowsFulfilmentUpdate(eventStatus: string): boolean {
  return eventAllowsReserving(eventStatus);
}

export function fulfilmentUpdateClosedMessage(eventStatus: string): string {
  return reservingClosedMessage(eventStatus);
}

/// The statuses offered in the "Fulfilment status" list for a line in this
/// status, current status first. Empty when the line cannot be updated.
export function fulfilmentOptionsFor(currentStatus: string): string[] {
  if (HOLDING_STATUSES.includes(currentStatus)) return [currentStatus, "unavailable"];
  if (HAND_PICKED_STATUSES.includes(currentStatus)) return HAND_PICKED_STATUSES;
  return [];
}

export interface FulfilmentRefusal {
  message: string;
  /// "staffNotes" when the problem is the notes, so the screen can show it
  /// under that field; null for anything about the line itself.
  field: "staffNotes" | null;
}

/// Why this update is refused, or null if it is fine.
export function checkFulfilmentUpdate(
  currentStatus: string,
  nextStatus: string,
  staffNotes: string
): FulfilmentRefusal | null {
  if (currentStatus === "cancelled") {
    return { message: "This request has been withdrawn and can no longer be updated.", field: null };
  }
  if (!fulfilmentOptionsFor(currentStatus).includes(nextStatus)) {
    let message = "That status cannot be chosen here.";
    if (HOLDING_STATUSES.includes(nextStatus)) message = "Use Reserve to commit equipment to this event.";
    else if (HOLDING_STATUSES.includes(currentStatus)) message = 'A reserved item can only be changed to "Cannot be provided".';
    return { message, field: null };
  }
  const notes = staffNotes.trim();
  if (notes.length > STAFF_NOTES_MAX_LENGTH) {
    return { message: `Technical notes must be ${STAFF_NOTES_MAX_LENGTH} characters or fewer.`, field: "staffNotes" };
  }
  if (nextStatus === "unavailable" && notes.length === 0) {
    return { message: "Give a reason when equipment cannot be provided.", field: "staffNotes" };
  }
  return null;
}

/// The fields to write for an accepted update.
export function fulfilmentChanges(
  nextStatus: string,
  staffNotes: string
): { status: string; staffNotes: string | null; quantityReserved?: null } {
  const notes = staffNotes.trim();
  return {
    status: nextStatus,
    staffNotes: notes.length > 0 ? notes : null,
    ...(nextStatus === "unavailable" ? { quantityReserved: null } : {}),
  };
}

/// Whether reserving a line clears Technical Support's notes. A line marked
/// Unavailable carries the reason it couldn't be provided ("both units out for
/// repair"), and a released one the reason it was released (SPM-69); once it
/// is reserved, that reason is no longer true and would contradict the
/// "Reserved" status the Coordinator sees. Notes on any other line are kept.
export function reserveClearsStaffNotes(previousStatus: string): boolean {
  return previousStatus === "unavailable" || previousStatus === "released";
}
