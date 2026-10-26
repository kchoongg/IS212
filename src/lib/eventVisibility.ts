// Limit Who Sees a Request's Review Outcome (SPM-94): Venue Staff, Technical
// Support and the Safety Officer see an event only from Approved onwards.
// Every status says by itself whether the event was approved - except
// Cancelled, which SPM-37 reaches from Under review as well as after approval.
// The status history says which: approving always writes a history row in the
// same transaction as the status (PATCH /api/events/[id]).
//
// canViewEvent() in permissions.ts stays pure and reads the answer from
// `everApproved`; the routes call canViewEventWithHistory() instead, which
// looks the history up only when the answer depends on it.

import { prisma } from "@/lib/prisma";
import { canViewEvent, needsApprovalHistory, type Actor, type EventAccessFields } from "@/lib/permissions";

/// canViewEvent(), with `everApproved` read from the status history when the
/// event is cancelled and the user sees events from Approved onwards - one
/// count, and only then.
export async function canViewEventWithHistory(
  actor: Actor,
  event: EventAccessFields & { id: string }
): Promise<boolean> {
  if (!needsApprovalHistory(actor, event)) return canViewEvent(actor, event);
  const approvals = await prisma.eventStatusHistory.count({ where: { eventId: event.id, toStatus: "approved" } });
  return canViewEvent(actor, { ...event, everApproved: approvals > 0 });
}
