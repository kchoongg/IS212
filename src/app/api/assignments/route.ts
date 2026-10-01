import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { ASSIGNABLE_STATUSES, REASSIGNABLE_STATUSES, can } from "@/lib/permissions";

/**
 * SPM-30 — the data behind the Assignments screen (S-28).
 *
 *   awaiting     submitted events with no coordinator (AC2; clarification
 *                #117: the Ops Manager must be able to identify them)
 *   assigned     live events that have one, for reassignment (AC6)
 *   coordinators every active Event Coordinator, the only people an event
 *                can be assigned to
 *
 * Ops Manager only. Choosing who gets an event is left to the Ops Manager's
 * own SOP outside the system (clarification #93), so no workload or ranking
 * is computed here.
 */

const EVENT_SELECT = {
  id: true,
  sequenceNumber: true,
  title: true,
  status: true,
  startsAt: true,
  endsAt: true,
  submittedAt: true,
  organisation: { select: { name: true } },
  coordinator: { select: { id: true, fullName: true } },
} as const;

export async function GET(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }
  if (!can(actor.role, "event:assign_coordinator")) {
    return forbidden("Only the Event Operations Manager can assign coordinators");
  }

  const [awaiting, assigned, coordinators] = await Promise.all([
    prisma.event.findMany({
      where: { status: { in: [...ASSIGNABLE_STATUSES] }, coordinatorId: null },
      // Longest-waiting first: that is the order they should be picked up in.
      orderBy: [{ submittedAt: "asc" }, { sequenceNumber: "asc" }],
      select: EVENT_SELECT,
    }),
    prisma.event.findMany({
      where: { status: { in: [...REASSIGNABLE_STATUSES] }, coordinatorId: { not: null } },
      orderBy: [{ startsAt: "asc" }, { sequenceNumber: "asc" }],
      select: EVENT_SELECT,
    }),
    prisma.user.findMany({
      where: { role: "coordinator", isActive: true },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true },
    }),
  ]);

  return NextResponse.json({ awaiting, assigned, coordinators });
}
