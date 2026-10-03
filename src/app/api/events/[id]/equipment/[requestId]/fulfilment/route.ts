import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, resolveEventId, unauthenticated } from "@/lib/apiAuth";
import { canUpdateEquipmentFulfilment, canViewEvent, techSupportSeesEquipment } from "@/lib/permissions";
import { updateEquipmentFulfilmentSchema } from "@/lib/validation";
import {
  checkFulfilmentUpdate,
  eventAllowsFulfilmentUpdate,
  fulfilmentChanges,
  fulfilmentUpdateClosedMessage,
} from "@/lib/equipmentFulfilment";
import { ZodError } from "zod";

// SPM-50 — Review and Update Equipment Request. Technical Support sets one
// line's fulfilment status and records technical notes (staffNotes) against
// it. The rules are in src/lib/equipmentFulfilment.ts.
//
// Same visibility pattern as the sibling equipment routes: an event the
// caller cannot see is 404 (never reveals it exists), then the role check.
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; requestId: string }> }
) {
  try {
    const { id, requestId } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    const eventId = await resolveEventId(id);
    const existing = eventId
      ? await prisma.equipmentRequest.findUnique({
          where: { id: requestId },
          select: {
            eventId: true,
            status: true,
            event: {
              select: { organiserId: true, organisationId: true, coordinatorId: true, status: true },
            },
          },
        })
      : null;
    if (!existing || existing.eventId !== eventId || !canViewEvent(actor, existing.event)) {
      return hidden();
    }
    if (!canUpdateEquipmentFulfilment(actor)) {
      return forbidden("Only Technical Support Staff can update equipment requests");
    }

    // Not visible to Technical Support before Planning (BPMN), and only
    // updatable while it is in Planning - a Confirmed event is read-only.
    if (!techSupportSeesEquipment(existing.event.status)) {
      return hidden();
    }
    if (!eventAllowsFulfilmentUpdate(existing.event.status)) {
      return NextResponse.json({ error: fulfilmentUpdateClosedMessage(existing.event.status) }, { status: 400 });
    }

    const data = updateEquipmentFulfilmentSchema.parse(await req.json());
    const refusal = checkFulfilmentUpdate(existing.status, data.status, data.staffNotes);
    if (refusal) {
      return NextResponse.json({ error: refusal.message, field: refusal.field }, { status: 400 });
    }

    // Only if the line is still in the status the rules were checked against:
    // a Reserve (SPM-49) or another update landing in between would otherwise
    // be silently overwritten - e.g. "Unavailable" saved over a fresh
    // reservation would leave stock committed to a line that says it is not.
    const { count } = await prisma.equipmentRequest.updateMany({
      where: { id: requestId, status: existing.status },
      data: {
        ...fulfilmentChanges(data.status, data.staffNotes),
        reviewedBy: actor.id,
        reviewedAt: new Date(),
      },
    });
    if (count === 0) {
      return NextResponse.json(
        { error: "This item was changed by someone else — refresh the page and try again." },
        { status: 409 }
      );
    }

    const updated = await prisma.equipmentRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        quantityReserved: true,
        staffNotes: true,
        reviewedAt: true,
        reviewer: { select: { fullName: true } },
      },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
