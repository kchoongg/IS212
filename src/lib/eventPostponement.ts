// Postpone Event (SPM-38). The assigned Coordinator postpones an event that has
// no new date yet, at any stage after approval that is not final (AC1, AC2;
// canTransition()), and what it holds is let go in the same transaction
// (PATCH /api/events/[id]), as Cancel Event does (SPM-37):
//
//   an Approved booking      -> released  (AC3; Venue Staff are told, as SPM-67)
//   a Pending request        -> withdrawn (AC3)
//   every equipment line     -> cancelled (AC3; reserved or not)
//   a pending Postponement request -> approved (AC2: the Coordinator has
//                               carried it out, as SPM-32 does for a cancellation);
//                               other change requests stay Pending
//   a pending or approved safety check -> closed (AC4)
//
// The event record is kept (AC3), and so are its registrations (AC8): an
// attendee who holds a place can still open it, but it is not upcoming - only
// Confirmed events take registrations or appear on Browse Events.
//
// While Postponed nothing new is arranged (AC6): its new date comes through a
// change request (SPM-35), and approving it moves the event to Approved
// (SPM-32, AC7), where planning begins again with the next venue or equipment
// action (SPM-54). Pure functions, like the rest of src/lib.

import { arrangementConsequences, type CancellationBooking, type CancellationEquipment } from "./eventCancellation";

export const EVENT_POSTPONED_MESSAGE =
  "The event has been postponed. Its venue bookings and equipment have been released.";
/// The amber alert on a postponed event's Overview (AC5).
export const POSTPONED_TITLE = "This event is postponed";
/// Shown in that alert when the reason was left empty (AC5).
export const NO_POSTPONEMENT_REASON = "No reason was recorded.";
/// The dialog, when postponing lets go of nothing.
export const NOTHING_TO_RELEASE = "This event has no venue bookings, equipment or registration to release.";
/// EventChangeRequest.reviewNotes on a postponement request it carried out (AC2),
/// as CANCELLATION_REQUEST_APPROVED_NOTE (SPM-32).
export const POSTPONEMENT_REQUEST_APPROVED_NOTE = "Approved: the event was postponed.";
/// SafetyCheck.decisionNote on a check the postponement closed (AC4).
export const SAFETY_CHECK_POSTPONED_NOTE = "Event postponed";

/// AC6: nothing new is arranged until the event has a new date.
export const POSTPONED_VENUE_MESSAGE =
  "A venue cannot be requested while the event is postponed. Its new date comes through a change request first.";
export const POSTPONED_EQUIPMENT_MESSAGE =
  "This event is postponed — equipment requirements can't be changed until it has a new date.";

export function postponeDialogText(title: string | null | undefined): string {
  return `${title || "This event"} will be marked Postponed. Its new date is set later, through a change request.`;
}

/// The reason stored on each booking the postponement released or withdrew,
/// shown on the Venue tab as "Reason for release: ..." (AC5).
export function arrangementPostponementNote(reason: string | null | undefined): string {
  const trimmed = reason?.trim();
  return trimmed ? `Event postponed: ${trimmed}` : "Event postponed.";
}

export interface PostponementInput {
  bookings: CancellationBooking[];
  equipment: CancellationEquipment[];
  pendingPostponementRequests: number;
  /// The event's open safety check, if any: waiting for review, or approved.
  safetyCheck: "pending" | "approved" | null;
  registration: { enabled: boolean; registered: number; waitlisted: number };
}

/// What postponing will let go, one line each, in the dialog's order:
/// bookings first and registration last. Empty when there is nothing.
export function postponementConsequences(input: PostponementInput): string[] {
  const lines = arrangementConsequences(input);

  const requests = input.pendingPostponementRequests;
  // As SPM-32's "Approve 1 cancellation request" in the Cancel event dialog.
  if (requests > 0) lines.push(`Approve ${requests} postponement request${requests === 1 ? "" : "s"}`);

  if (input.safetyCheck === "pending") lines.push("Close the pending safety check");
  if (input.safetyCheck === "approved") lines.push("Close the safety approval");

  const { enabled, registered, waitlisted } = input.registration;
  if (enabled) {
    lines.push(
      `Pause registration until the event is confirmed again: ${registered} registered, ${waitlisted} on the waiting list`
    );
  }

  return lines;
}
