import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { REVIEWABLE_STATUSES, can } from "@/lib/permissions";

/**
 * SPM-28 — the data behind the Review Queue (S-12).
 *
 * The requests the signed-in coordinator is authorised to review (AC1): the
 * ones assigned to them (SPM-30) that are still under review. A colleague's
 * requests and ones already decided are not theirs to review, so they are
 * not listed - see canReviewEvent() in src/lib/permissions.ts, which this
 * query mirrors.
 */
export async function GET(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }
  if (!can(actor.role, "event:review")) {
    return forbidden("Only an Event Coordinator can review event requests");
  }

  const events = await prisma.event.findMany({
    where: { coordinatorId: actor.id, status: { in: [...REVIEWABLE_STATUSES] } },
    // Longest-waiting first: that is the order they should be reviewed in.
    orderBy: [{ submittedAt: "asc" }, { sequenceNumber: "asc" }],
    select: {
      id: true,
      sequenceNumber: true,
      title: true,
      status: true,
      startsAt: true,
      endsAt: true,
      submittedAt: true,
      organisation: { select: { name: true } },
    },
  });

  return NextResponse.json(events);
}
