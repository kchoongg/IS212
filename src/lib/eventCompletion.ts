// Mark Event as Completed (SPM-36). "After the event has taken place, the
// Event Coordinator can mark it as completed. If it remains open, the system
// may automatically mark it as completed 7 days after the event end date"
// (clarification #71).
//
// The lifecycle already allows Confirmed -> Completed for the assigned
// coordinator, and nothing leaves Completed (EVENT_TRANSITIONS in
// statuses.ts). What this adds is WHEN: not before the event has ended, and
// automatically once it has been over for 7 days. Completing changes nothing
// but the status - the venue bookings and equipment stay on the event as the
// record of what took place (AC3).
//
// Pure, like the rest of src/lib; eventCompletionService.ts applies the
// automatic completion to the database.

/// AC6: how long a Confirmed event may stay open after it ends.
export const AUTO_COMPLETE_AFTER_DAYS = 7;

const DAY_MS = 86_400_000;

export const NOT_ENDED_MESSAGE = "This event hasn't ended yet, so it can't be marked completed.";

/// The reason on the status history entry of an automatic completion, which
/// has no user (decided 2026-10-22).
export const AUTO_COMPLETE_REASON = "Completed automatically 7 days after the event ended";

/// Has the event taken place? An event with no end has not.
export function hasEnded(endsAt: Date | string | null | undefined, now: Date): boolean {
  if (!endsAt) return false;
  return new Date(endsAt).getTime() <= now.getTime();
}

/// AC6: an event still Confirmed that ended at or before this moment is
/// completed automatically - exactly 7 x 24 hours after its end.
export function autoCompleteCutoff(now: Date): Date {
  return new Date(now.getTime() - AUTO_COMPLETE_AFTER_DAYS * DAY_MS);
}

/// The success message after the coordinator marks the event completed.
export function completedMessage(title: string | null | undefined): string {
  return `${title || "This event"} has been marked as completed.`;
}
