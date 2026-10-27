import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { parseEventReference } from "@/lib/format";
import { canSetEventStatus } from "@/lib/permissions";
import { PLANNING_REASONS, beginPlanningIfApproved } from "@/lib/beginPlanning";
import { canViewEventWithHistory } from "@/lib/eventVisibility";

/**
 * SPM-54 — begin planning an Approved event.
 *
 *   POST /api/events/EVT-000123/begin-planning
 *
 * Called when the assigned coordinator presses Search on Find a venue (S-14).
 * The other actions that begin planning - requesting a venue booking, and
 * adding, changing or removing an equipment requirement - do it inside their
 * own routes; all of them go through beginPlanningIfApproved(), so there is
 * one way into Planning and the status history gets exactly one row for it.
 *
 * Answers { planningStarted }. An event that is not Approved is left as it is
 * and answers false - that is not an error, the search simply goes on.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    const sequenceNumber = parseEventReference(id);
    const event =
      sequenceNumber === null ? null : await prisma.event.findUnique({ where: { sequenceNumber } });
    // Same order as every other event route: an event the user cannot see is
    // 404 before any role check, so its existence is never confirmed.
    if (!event || !(await canViewEventWithHistory(actor, event))) {
      return hidden();
    }
    if (!canSetEventStatus(actor, event, "planning")) {
      return forbidden("Only the assigned Coordinator can begin planning this event");
    }

    const planningStarted = await prisma.$transaction((tx) =>
      beginPlanningIfApproved(tx, event, actor.id, PLANNING_REASONS.venueSearch)
    );
    return NextResponse.json({ planningStarted });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
