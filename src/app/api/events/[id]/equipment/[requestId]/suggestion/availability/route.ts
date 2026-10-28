import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, resolveEventId, unauthenticated } from "@/lib/apiAuth";
import { canSuggestAlternativeEquipment, techSupportSeesEquipment } from "@/lib/permissions";
import { ALTERNATIVE_REQUEST_SELECT, loadAlternativeAvailability } from "@/lib/equipmentAvailabilityService";
import { canViewEventWithHistory } from "@/lib/eventVisibility";
import { alternativeAvailabilityQuerySchema } from "@/lib/validation";

// SPM-77 (AC2) — "The system shows whether the suggested alternative is
// available for the event's dates before it is recorded." Technical Support's
// suggestion form asks this as soon as an item and a quantity are chosen; the
// suggestion route (../route.ts) checks it again when recording. Read-only.
//
// Same checks, in the same order, as the sibling equipment routes: 404 for an
// event the caller cannot see, then the role, then 404 for an event Technical
// Support does not see the equipment of.
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; requestId: string }> }
) {
  try {
    const { id, requestId } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    // Read once: the access check and the availability service both use it.
    const eventId = await resolveEventId(id);
    const existing = eventId
      ? await prisma.equipmentRequest.findUnique({
          where: { id: requestId },
          select: {
            ...ALTERNATIVE_REQUEST_SELECT,
            eventId: true,
            event: {
              select: {
                ...ALTERNATIVE_REQUEST_SELECT.event.select,
                organiserId: true,
                organisationId: true,
                coordinatorId: true,
                status: true,
              },
            },
          },
        })
      : null;
    if (!existing || existing.eventId !== eventId || !(await canViewEventWithHistory(actor, { ...existing.event, id: existing.eventId }))) {
      return hidden();
    }
    if (!canSuggestAlternativeEquipment(actor)) {
      return forbidden("Only Technical Support Staff can suggest alternative equipment");
    }
    if (!techSupportSeesEquipment(existing.event.status)) {
      return hidden();
    }

    const query = alternativeAvailabilityQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const checked = await loadAlternativeAvailability(prisma, existing, query.equipmentId, query.quantity);
    if (!checked.alternative) {
      return NextResponse.json({ error: "Choose an item from the equipment catalogue." }, { status: 400 });
    }
    return NextResponse.json({
      equipmentId: checked.alternative.id,
      equipmentName: checked.alternative.name,
      result: checked.result,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
