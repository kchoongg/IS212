// Begin Event Planning (SPM-54). An Approved event moves to Planning with the
// assigned coordinator's first venue or equipment action (decided 2026-10-02):
// pressing Search on Find a venue, requesting a venue booking, or adding,
// changing or removing an equipment requirement. There is no separate "Begin
// planning" step; opening a page, Clear filters and Cancel do not count.
//
// Every one of them goes through beginPlanningIfApproved(), so there is one
// way into Planning. The booking and equipment routes call it inside the same
// transaction as their own write, so the arrangement and the status change
// land together; the venue search calls it through POST
// /api/events/[id]/begin-planning. The general status route refuses the move.
//
// Like sessionWrites.ts, this needs a Prisma transaction, so it is not one of
// the pure src/lib modules.

import type { Prisma } from "@prisma/client";
import { PLANNING_FROM_STATUSES } from "@/lib/permissions";

/// Status history reasons, one per action that begins planning. The venue
/// search's is the seed's own wording for this move.
export const PLANNING_REASONS = {
  venueSearch: "Venue search started",
  venueBooking: "Venue booking requested",
  equipmentAdded: "Equipment requirement recorded",
  equipmentUpdated: "Equipment requirement updated",
  equipmentRemoved: "Equipment requirement removed",
} as const;

/// Moves the event to Planning if it is Approved, and records the move in its
/// status history. Returns whether it did - false for an event already in
/// Planning or past it, which is left exactly as it is.
///
/// The caller has already checked that the actor is the assigned coordinator
/// (canRequestVenueBooking / canManageEquipmentRequests / canSetEventStatus).
export async function beginPlanningIfApproved(
  tx: Prisma.TransactionClient,
  event: { id: string; status: string },
  actorId: string,
  reason: string
): Promise<boolean> {
  if (!PLANNING_FROM_STATUSES.includes(event.status)) return false;

  // updateMany so the status is re-checked in the database: two actions at
  // once must not write the move, or its history row, twice.
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
      reason,
    },
  });
  return true;
}
