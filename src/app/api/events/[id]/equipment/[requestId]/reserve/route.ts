import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, resolveEventId, unauthenticated } from "@/lib/apiAuth";
import { canReserveEquipment, canViewEvent } from "@/lib/permissions";
import { RELEASED_EVENT_STATUSES, reserveQuantity } from "@/lib/equipmentAvailability";
import { loadSingleLineAvailability } from "@/lib/equipmentAvailabilityService";
import { TERMINAL_EVENT_STATUSES } from "@/lib/statuses";

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
            select: { organiserId: true, organisationId: true, coordinatorId: true, status: true },
          },
        },
      })
    : null;
  if (!existing || existing.eventId !== eventId || !canViewEvent(actor, existing.event)) {
    return hidden();
  }
  if (!canReserveEquipment(actor)) {
    return forbidden("Only Technical Support Staff can reserve equipment");
  }

  // ADDED: cancelling or postponing an event releases its arrangements
  // (customer Q&A #68, #69; SPM-37/38, not yet built) - reserving into one is
  // the same mistake in the other direction. A draft is invisible to
  // Technical Support already (canViewEvent), so this mainly catches
  // cancelled/postponed/rejected/completed.
  if (TERMINAL_EVENT_STATUSES.includes(existing.event.status) || RELEASED_EVENT_STATUSES.includes(existing.event.status)) {
    return NextResponse.json(
      { error: `This event is ${existing.event.status} — equipment can no longer be reserved.` },
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

      return tx.equipmentRequest.update({
        where: { id: requestId },
        data: {
          quantityReserved: toReserve,
          status: toReserve === line.quantityRequested ? "reserved" : "partially_fulfilled",
          reviewedBy: actor.id,
          reviewedAt: new Date(),
        },
        include: {
          equipment: { select: { id: true, name: true, category: true } },
          session: { select: { id: true, label: true, startsAt: true, endsAt: true } },
        },
      });
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
