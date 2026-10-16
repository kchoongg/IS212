// Resolve Safety Check Outcome (SPM-88, AC5 and AC6): a significant change
// made while the event rests on a safety check - waiting for one, or approved
// by one - closes that check and returns the event to Planning, so it is
// checked again before it can be confirmed. The rules are in
// src/lib/safetyResolution.ts; this writes them in the caller's transaction,
// like src/lib/beginPlanning.ts.
//
// Called by every place the coordinator saves a significant change: the
// event information route (SPM-62), the equipment routes, and the venue
// booking request (SPM-42) and withdraw/release (SPM-67) routes.

import type { Prisma } from "@prisma/client";
import { OPEN_CHECK_STATUSES, SAFETY_HELD_STATUSES, closeHistoryReason } from "@/lib/safetyResolution";

/// Closes the event's pending or approved check. The decision fields record
/// who closed it, when, and what changed. False when there was none open.
export async function closeSafetyCheck(
  tx: Prisma.TransactionClient,
  eventId: string,
  actorId: string,
  why: string,
  now: Date = new Date()
): Promise<boolean> {
  const closed = await tx.safetyCheck.updateMany({
    where: { eventId, status: { in: OPEN_CHECK_STATUSES } },
    data: { status: "closed", decidedBy: actorId, decidedAt: now, decisionNote: why },
  });
  return closed.count > 0;
}

/// After a significant change: an event in Safety review or Safety approved
/// goes back to Planning with its check closed. A Confirmed event the caller
/// has just moved back to Planning (SPM-62) has its approval closed too.
/// Returns whether a check was closed; any other event is left alone.
export async function closeSafetyCheckAfterChange(
  tx: Prisma.TransactionClient,
  event: { id: string; status: string },
  actorId: string,
  why: string,
  confirmationReverted: boolean,
  now: Date = new Date()
): Promise<boolean> {
  if (confirmationReverted) return closeSafetyCheck(tx, event.id, actorId, why, now);
  if (!SAFETY_HELD_STATUSES.includes(event.status)) return false;

  // updateMany so the status is re-checked in the database, as
  // beginPlanningIfApproved() does: two changes at once move it once.
  const moved = await tx.event.updateMany({
    where: { id: event.id, status: event.status },
    data: { status: "planning" },
  });
  if (moved.count === 0) return false;

  await tx.eventStatusHistory.create({
    data: {
      eventId: event.id,
      fromStatus: event.status,
      toStatus: "planning",
      changedBy: actorId,
      reason: closeHistoryReason(why),
    },
  });
  await closeSafetyCheck(tx, event.id, actorId, why, now);
  return true;
}
