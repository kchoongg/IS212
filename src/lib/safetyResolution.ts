// Resolve Safety Check Outcome (SPM-88): what follows a Safety Officer's
// decision (SPM-87), and what undoes one.
//
//   - Every submission and decision stays on record, and staff see them all in
//     the event's "Safety check history" (AC1).
//   - After a check is returned (changes requested or rejected), the assigned
//     coordinator may flag the arrangements it concerns for review (AC3). The
//     flags block resubmission until they are cleared in Review Flagged
//     Arrangements (SPM-68), so the changes are made before the check is
//     submitted again (SPM-86 AC2).
//   - A significant change made while a check is pending or approved closes
//     that check and returns the event to Planning, so it is checked again
//     before it can be confirmed (AC5, AC6). Decided 2026-10-15: significant
//     means the coordinator's own important information change (SPM-62),
//     equipment change, or venue booking requested, withdrawn or released.
//
// Pure, like the rest of src/lib. src/lib/safetyCheckClose.ts writes the
// closing in a transaction.

import { z } from "zod";
import { formatDateTime } from "@/lib/format";
import type { ImportantChange } from "@/lib/eventChangeImpact";
import type { SafetyCheckView } from "@/lib/safetyDecision";

/// AC3: the reason code a flagged arrangement carries, beside SPM-39's and
/// SPM-62's in the same reviewReason column.
export const SAFETY_RETURNED_REASON = "safety_check_returned";

export const SAFETY_REASON_PROSE: Record<string, string> = {
  [SAFETY_RETURNED_REASON]: "the Safety Officer returned the safety check",
};

/// A returned check: the event is back in Planning with work to do.
export const RETURNED_CHECK_STATUSES = ["changes_requested", "rejected"];

/// AC3: flagging follows a returned check, while the event is back in
/// Planning. Once resubmitted, the check is the Safety Officer's again.
export function canFlagAfterReturn(eventStatus: string, latestCheckStatus: string | null | undefined): boolean {
  return eventStatus === "planning" && RETURNED_CHECK_STATUSES.includes(latestCheckStatus ?? "");
}

/// AC5, AC6: the statuses that rest on a safety check - waiting for it, or
/// approved by it. A significant change in either sends the event back.
export const SAFETY_HELD_STATUSES = ["safety_review", "safety_cleared"];

/// The checks a significant change closes: still waiting, or approved.
export const OPEN_CHECK_STATUSES = ["pending", "approved"];

const CHANGE_PROSE: Record<ImportantChange, string> = {
  schedule: "the date or time changed",
  attendance: "the expected attendance changed",
  venue_requirements: "the venue requirements changed",
  equipment: "the equipment changed",
};

/// Why a check was closed, from an event information change.
export function closeReasonFor(changes: readonly ImportantChange[]): string {
  return changes.map((c) => CHANGE_PROSE[c]).join(", ");
}

/// Why a check was closed, from the arrangement routes.
export const CLOSE_REASONS = {
  equipment: CHANGE_PROSE.equipment,
  bookingRequested: "a venue booking was requested",
  bookingWithdrawn: "a venue booking was withdrawn",
  bookingReleased: "a venue booking was released",
} as const;

/// The status-history reason for the move back to Planning.
export function closeHistoryReason(why: string): string {
  return `Safety check closed: ${why}`;
}

/// "Closed after a change on 15 Oct 2026, 14:30: the equipment changed"
export function closedCheckLine(closedAt: string, why: string | null | undefined): string {
  const line = `Closed after a change on ${formatDateTime(closedAt)}`;
  return why ? `${line}: ${why}` : line;
}

const OUTCOME: Record<string, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  rejected: "Rejected",
};

const by = (name: string | null | undefined) => (name ? ` by ${name}` : "");

/// AC1: one line of the "Safety check history" card.
///   "Submitted by Daniel Tan, 8 Oct 2026, 14:00 - Rejected by Hana Yusof, 9 Oct 2026, 10:00. Reason: …"
export function safetyHistoryLine(check: SafetyCheckView): string {
  const submitted = `Submitted${by(check.submittedBy)}${check.submittedBy ? "," : ""} ${formatDateTime(check.submittedAt)}`;
  return `${submitted} - ${outcomeOf(check)}`;
}

function outcomeOf(check: SafetyCheckView): string {
  if (check.status === "closed" && check.decidedAt) return closedCheckLine(check.decidedAt, check.decisionNote);
  const outcome = OUTCOME[check.status];
  if (!outcome || !check.decidedAt) return "Awaiting review";
  const line = `${outcome}${by(check.decidedBy)}${check.decidedBy ? "," : ""} ${formatDateTime(check.decidedAt)}`;
  if (!check.decisionNote) return line;
  const label = check.status === "rejected" ? "Reason" : "Changes required";
  return `${line}. ${label}: ${check.decisionNote}`;
}

// ---------------------------------------------------------------------------
// FLAGGING AFTER A RETURNED CHECK (AC3)
// ---------------------------------------------------------------------------

export const SAFETY_FLAG_FORBIDDEN_MESSAGE =
  "Only the coordinator assigned to this event can flag its arrangements for review.";
export const SAFETY_FLAG_NONE_MESSAGE = "Choose at least one arrangement to flag.";
export const SAFETY_FLAG_NOT_RETURNED_MESSAGE =
  "Arrangements can be flagged for review only after the Safety Officer returns the safety check, while the event is in Planning.";
export const SAFETY_FLAG_STALE_MESSAGE =
  "Some of these arrangements can no longer be flagged. Reload the page and try again.";

/// What can be flagged: the bookings that hold or ask for a venue, and the
/// equipment lines still wanted.
export const FLAGGABLE_BOOKING_STATUSES = ["pending", "approved"];
export const UNFLAGGABLE_EQUIPMENT_STATUS = "cancelled";

export const safetyFlagsSchema = z
  .object({
    venueBookingIds: z.array(z.string()).default([]),
    equipmentRequestIds: z.array(z.string()).default([]),
  })
  .strict();

/// "2 arrangements flagged for review. Nothing has been changed or cancelled."
export function safetyFlaggedMessage(count: number): string {
  return `${count} ${count === 1 ? "arrangement" : "arrangements"} flagged for review. Nothing has been changed or cancelled.`;
}

// ---------------------------------------------------------------------------
// ASKING FIRST (AC5, AC6)
// ---------------------------------------------------------------------------

/// The edit page's and the Equipment tab's "Move this event back to
/// Planning?" question, before a significant change to an event that rests
/// on a safety check, or a Confirmed one (SPM-62). Null when the change
/// moves nothing.
export function backToPlanningWarning(title: string | null, status: string, change: "information" | "equipment"): string | null {
  const event = title || "This event";
  const doing = change === "information" ? "Saving these changes" : "Changing its equipment";
  const again = "It will need to be submitted for a safety check again.";
  if (status === "confirmed") {
    return `${event} is Confirmed. ${doing} moves it back to Planning, where it needs a new safety check before it can be confirmed again.`;
  }
  if (status === "safety_cleared") {
    return `${event} is Safety approved. ${doing} cancels the safety approval and moves it back to Planning. ${again}`;
  }
  if (status === "safety_review") {
    return `${event} is in Safety review. ${doing} closes the pending safety check and moves it back to Planning. ${again}`;
  }
  return null;
}

/// After the save: the event is back in Planning, and Confirm waits for a new
/// safety check.
export const BACK_TO_PLANNING_SAVED =
  "Event information updated. The event is back in Planning and needs to be submitted for a safety check again.";

/// After a venue booking change closed the check (the Venue tab, the request form).
export const SAFETY_CLOSED_TITLE = "The safety check was closed";
export const SAFETY_CLOSED_NOTICE =
  "The event's safety check was closed and it is back in Planning. Submit it for a safety check again once the arrangements are settled.";
