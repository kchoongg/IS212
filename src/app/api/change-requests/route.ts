import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { eventReference } from "@/lib/format";
import { describeChangeRequest, snapshotOf } from "@/lib/eventChangeRequest";

// Request Event Change (SPM-35, AC4): the change requests waiting for the
// signed-in coordinator - pending, on the events assigned to them, newest
// first, each marked Important or not. The coordinator's Change Requests page.
// Processing them is Process Event Change Request (SPM-32).

export async function GET(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    if (actor.role !== "coordinator") {
      return forbidden("Only an Event Coordinator has change requests to process.");
    }

    const rows = await prisma.eventChangeRequest.findMany({
      where: { status: "pending", event: { coordinatorId: actor.id } },
      orderBy: { requestedAt: "desc" },
      include: {
        requester: { select: { fullName: true } },
        event: {
          include: { facilityRequirements: { select: { facilityId: true, facility: { select: { name: true } } } } },
        },
      },
    });

    return NextResponse.json(
      rows.map(({ event, ...row }) => ({
        ...describeChangeRequest(row, snapshotOf(event)),
        event: { reference: eventReference(event.sequenceNumber), title: event.title, status: event.status },
      }))
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
