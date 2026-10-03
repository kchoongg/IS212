import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { canCheckEquipmentAvailability, canViewEvent, techSupportSeesEquipment } from "@/lib/permissions";
import { loadEventAvailability } from "@/lib/equipmentAvailabilityService";
import { parseEventReference } from "@/lib/format";

// SPM-48 — Check Equipment Availability. For each equipment line an event has
// requested, whether enough suitable stock is free for the event's dates. Shown
// automatically on the Equipment request screen (S-25 mockup), so this is a
// plain GET with no trigger of its own. Read-only: reserving is SPM-49.
//
// `id` is the event's reference (e.g. "EVT-000123"), resolved the same way as
// the sibling /equipment route (SPM-31).
//
// Same two-step visibility as the sibling routes: an event the caller cannot
// see is 404 (its existence is never confirmed), then the role check on top.
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }

  const sequenceNumber = parseEventReference(id);
  const event = sequenceNumber === null ? null : await prisma.event.findUnique({ where: { sequenceNumber } });
  if (!event || !canViewEvent(actor, event)) {
    return hidden();
  }
  if (!canCheckEquipmentAvailability(actor)) {
    return forbidden("Only Technical Support Staff can check equipment availability");
  }
  // Not before the Coordinator has started planning, and not once the event
  // is over or called off - the same 404 as an event they cannot see.
  if (!techSupportSeesEquipment(event.status)) {
    return hidden();
  }

  const availability = await loadEventAvailability(event.id);
  if (!availability) {
    return hidden();
  }
  return NextResponse.json(availability);
}
