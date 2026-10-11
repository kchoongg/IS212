// Submit Event for Operational Safety Check (SPM-86, Week 7 change #6): "After
// the venue and technical arrangements have been confirmed, the Safety Officer
// must conduct an Operational Safety Check before the event can proceed."
//
// An event is ready to submit when:
//   - every arrangement Confirm event requires is held (arrangementsFor(),
//     SPM-34): an approved venue for each session, and every recorded
//     equipment item reserved or partially fulfilled (decided 2026-10-09: the
//     same rule as Confirm, so the two never disagree), and
//   - none of those held arrangements is flagged for review (AC2). A flag is
//     set by a venue edit (SPM-39) or an event change (SPM-62) and cleared by
//     Review Flagged Arrangements (SPM-68).
//
// A flag on an arrangement that is not held adds nothing: an unheld one is
// already named, and a rejected or cancelled one is not in play.
//
// Pure functions over plain data, like the rest of src/lib.

import { arrangementsFor, type SessionRef } from "@/lib/eventConfirmation";
import { CHANGE_REASON_PROSE } from "@/lib/eventChangeImpact";
import { IMPACT_REASON_PROSE } from "@/lib/venueImpact";
import { EQUIPMENT_REASON_PROSE } from "@/lib/equipmentOutOfService";

export const SAFETY_CHECK_PENDING_MESSAGE = "A safety check is already pending for this event.";

const BOOKING_HELD = ["approved"];
/// The same as EQUIPMENT_HELD in eventConfirmation.ts.
const EQUIPMENT_HELD = ["reserved", "partially_fulfilled"];

interface Flag {
  needsReview: boolean;
  reviewReason: string | null;
}

export interface SafetySubmissionInput {
  /// Empty for a single-session event.
  sessions: readonly SessionRef[];
  bookings: readonly ({ sessionId: string | null; status: string; venueName: string } & Flag)[];
  equipment: readonly ({ sessionId: string | null; status: string; equipmentName: string } & Flag)[];
}

export type SafetySubmissionCheck =
  | { ok: true }
  | { ok: false; error: string; outstanding: string[] };

/// Every reason code a flag may carry, in words. Venue edits (SPM-39), event
/// changes (SPM-62) and equipment out of service (SPM-55) share the
/// reviewReason columns.
const REASON_PROSE: Record<string, string> = {
  ...CHANGE_REASON_PROSE,
  ...IMPACT_REASON_PROSE,
  ...EQUIPMENT_REASON_PROSE,
};

/** " (the date or time changed, the venue has been retired)", or "" when none is known. */
function why(reviewReason: string | null): string {
  const words = (reviewReason ?? "")
    .split(",")
    .map((code) => REASON_PROSE[code.trim()])
    .filter(Boolean);
  return words.length > 0 ? ` (${words.join(", ")})` : "";
}

/** "this event" / "the Day 2 session" - as Confirm event refers to it. */
function whose(sessions: readonly SessionRef[], sessionId: string | null): string {
  const session = sessionId == null ? null : sessions.find((s) => s.id === sessionId);
  if (!session) return "this event";
  return session.label ? `the ${session.label} session` : "one session";
}

/// AC1 and AC2: submission is refused while a required arrangement is not
/// held or a held one is flagged for review, and the refusal names each one.
export function checkSafetySubmission(input: SafetySubmissionInput): SafetySubmissionCheck {
  const { sessions, bookings, equipment } = input;

  const unheld = arrangementsFor({ sessions, bookings, equipment })
    .filter((a) => a.required && !a.complete)
    .map((a) => a.missing);

  const flaggedBookings = bookings
    .filter((b) => b.needsReview && BOOKING_HELD.includes(b.status))
    .map(
      (b) =>
        `the venue booking at ${b.venueName} for ${whose(sessions, b.sessionId)} is flagged for review${why(b.reviewReason)}`
    );
  const flaggedEquipment = equipment
    .filter((e) => e.needsReview && EQUIPMENT_HELD.includes(e.status))
    .map((e) => `${e.equipmentName} for ${whose(sessions, e.sessionId)} is flagged for review${why(e.reviewReason)}`);

  const outstanding = [...unheld, ...flaggedBookings, ...flaggedEquipment];
  if (outstanding.length === 0) return { ok: true };

  return {
    ok: false,
    error: `This event cannot be submitted for a safety check yet: ${outstanding.join("; ")}.`,
    outstanding,
  };
}
