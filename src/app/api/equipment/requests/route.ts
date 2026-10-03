import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { TECH_SUPPORT_EQUIPMENT_STATUSES, canCheckEquipmentAvailability, eventListWhere } from "@/lib/permissions";

// SPM-48 / S-25 — the Equipment Requests queue: events that have equipment
// requested, so Technical Support can open one and see whether it can be
// supported. Technical Support only (the same rule as the availability check
// itself). Scoped with eventListWhere, so a draft - which is private to the
// organiser who owns it - never appears here.
export async function GET(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }
  if (!canCheckEquipmentAvailability(actor)) {
    return forbidden("Only Technical Support Staff can view the equipment requests queue");
  }

  const events = await prisma.event.findMany({
    where: {
      AND: [
        eventListWhere(actor),
        // Only once the Coordinator has started planning (BPMN) - see
        // TECH_SUPPORT_EQUIPMENT_STATUSES.
        { status: { in: [...TECH_SUPPORT_EQUIPMENT_STATUSES] } },
        { equipmentRequests: { some: { status: { not: "cancelled" } } } },
      ],
    },
    orderBy: [{ startsAt: "asc" }, { sequenceNumber: "asc" }],
    select: {
      sequenceNumber: true,
      title: true,
      status: true,
      startsAt: true,
      endsAt: true,
      _count: { select: { equipmentRequests: { where: { status: { not: "cancelled" } } } } },
    },
  });

  return NextResponse.json(
    events.map(({ _count, ...event }) => ({ ...event, requestCount: _count.equipmentRequests }))
  );
}
