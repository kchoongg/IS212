import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, resolveEventId, unauthenticated } from "@/lib/apiAuth";
import { canReserveEquipment, techSupportSeesEquipment } from "@/lib/permissions";
import { eventAllowsReserving, reserveQuantity, reservingClosedMessage } from "@/lib/equipmentAvailability";
import { loadSingleLineAvailability } from "@/lib/equipmentAvailabilityService";
import { equipmentStatusNotification, reserveClearsStaffNotes } from "@/lib/equipmentFulfilment";
import { notifyUser } from "@/lib/notifications";
import { canViewEventWithHistory } from "@/lib/eventVisibility";

// SPM-49 — Reserve Equipment. "As Technical Support Staff, I want to reserve
// available equipment for an event so that the same limited equipment is not
// committed to incompatible events."
//
// Team decision (docs/test-cases/SPM-49_test_cases.json): there is no
// quantity to type in. Reserving always takes reserveQuantity(requested,
// available) - never more than either one - so this route needs nothing from
// the request body; the line to reserve is the whole of the URL.
//
// AC5's "prevents reservations exceeding available quantities" has to hold
// even when two Technical Support users click Reserve on the same equipment
// at the same moment (customer Q&A #35: block double-booking outright, not a
// warning). A single row update can't enforce that by itself - two
// transactions can both read "1 available" before either writes. So this
// takes a row lock on the Equipment item first (`SELECT ... FOR UPDATE`),
// serialising any two reservations that touch the same item, and only then
// re-reads availability *inside* that lock, via loadSingleLineAvailability().
// Whichever request gets the lock second sees the first one's reservation
// already committed.
//
// Same visibility pattern as the sibling equipment routes: an event the
// caller cannot see is 404 (never reveals it exists), then the role check.
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; requestId: string }> }
) {
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
          equipmentId: true,
          event: {
            select: { title: true, organiserId: true, organisationId: true, coordinatorId: true, status: true },
          },
        },
      })
    : null;
  if (!existing || existing.eventId !== eventId || !(await canViewEventWithHistory(actor, { ...existing.event, id: existing.eventId }))) {
    return hidden();
  }
  if (!canReserveEquipment(actor)) {
    return forbidden("Only Technical Support Staff can reserve equipment");
  }
  if (!techSupportSeesEquipment(existing.event.status)) {
    return hidden();
  }

  // Reserving happens in Planning (BPMN). The only other status Technical
  // Support can see is Confirmed, whose equipment is final - a change to it
  // goes through a change request.
  if (!eventAllowsReserving(existing.event.status)) {
    return NextResponse.json(
      { error: reservingClosedMessage(existing.event.status) },
      { status: 400 }
    );
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Serialises every reservation attempt against this one equipment item.
      await tx.$queryRaw`SELECT id FROM equipment WHERE id = ${existing.equipmentId} FOR UPDATE`;

      const line = await loadSingleLineAvailability(tx, requestId);
      if (!line || !line.result) {
        throw new RouteError(400, "Set the event date and time before reserving equipment");
      }
      if (line.requestStatus === "cancelled") {
        throw new RouteError(400, "This request has been withdrawn and can no longer be reserved.");
      }

      const toReserve = reserveQuantity(line.quantityRequested, line.result.available);
      if (toReserve === 0) {
        throw new RouteError(400, "Nothing is available for these dates any more.");
      }

      const updated = await tx.equipmentRequest.update({
        where: { id: requestId },
        data: {
          quantityReserved: toReserve,
          status: toReserve === line.quantityRequested ? "reserved" : "partially_fulfilled",
          reviewedBy: actor.id,
          reviewedAt: new Date(),
          // SPM-50: an Unavailable line's reason no longer holds once stock is
          // committed to it, so reserving it clears the reason.
          ...(reserveClearsStaffNotes(line.requestStatus) ? { staffNotes: null } : {}),
        },
        include: {
          equipment: { select: { id: true, name: true, category: true } },
          session: { select: { id: true, label: true, startsAt: true, endsAt: true } },
        },
      });
      // SPM-53 (AC11): Reserved or Partially fulfilled, to the assigned Coordinator.
      // v8 ignore next -- only a Planning event can be reserved for, and it always has a coordinator
      if (existing.event.coordinatorId) {
        await notifyUser(
          tx,
          existing.event.coordinatorId,
          equipmentStatusNotification({
            eventId: existing.eventId,
            eventTitle: existing.event.title,
            equipmentName: updated.equipment.name,
            status: updated.status,
          })
        );
      }
      return updated;
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof RouteError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/// Thrown inside the transaction to carry an HTTP status back out - Prisma
/// rolls the transaction back on any thrown error, which is what a refused
/// reservation needs anyway (nothing should be written).
class RouteError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
