import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { ASSIGNABLE_STATUSES, can } from "@/lib/permissions";
import { ACTIVE_EVENT_STATUSES, LEAD_ONLY_MESSAGE, coordinatorWorkload } from "@/lib/coordinatorAssignments";
import { completeDueEvents } from "@/lib/eventCompletionService";

/**
 * SPM-30 — the data behind the Assignments screen (S-28).
 *
 *   awaiting     submitted events with no coordinator (AC2; clarification
 *                #117: the Lead must be able to identify them)
 *   active       SPM-84 (AC5, AC6): every active event, with or without a
 *                coordinator, for oversight and reassignment (was `assigned`,
 *                live events that had one)
 *   coordinators every active Event Coordinator, the only people an event
 *                can be assigned to
 *   workload     SPM-84 (AC4, AC10): each coordinator with their number of
 *                active events, zero included
 *
 * The Event Coordinator Lead only (the Event Operations Manager until
 * SPM-84). Choosing who gets an event is left to the Lead's own SOP outside
 * the system (clarification #93); the counts inform it, they rank nobody.
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
    return forbidden(LEAD_ONLY_MESSAGE);
  }

  // SPM-36 (AC6): an event 7 days past its end is no longer an active event.
  await completeDueEvents();

  const [awaiting, active, accounts] = await Promise.all([
    prisma.event.findMany({
      where: { status: { in: [...ASSIGNABLE_STATUSES] }, coordinatorId: null },
      // Longest-waiting first: that is the order they should be picked up in.
      orderBy: [{ submittedAt: "asc" }, { sequenceNumber: "asc" }],
      select: EVENT_SELECT,
    }),
    prisma.event.findMany({
      where: { status: { in: ACTIVE_EVENT_STATUSES } },
      orderBy: [{ startsAt: "asc" }, { sequenceNumber: "asc" }],
      select: EVENT_SELECT,
    }),
    // Every coordinator, deactivated ones too: one may still hold events.
    prisma.user.findMany({
      where: { role: "coordinator" },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, isActive: true },
    }),
  ]);

  const coordinators = accounts.filter((c) => c.isActive).map(({ id, fullName }) => ({ id, fullName }));
  const workload = coordinatorWorkload(accounts, active);

  return NextResponse.json({ awaiting, active, coordinators, workload });
}
