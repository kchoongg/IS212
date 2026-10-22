import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, resolveEventId, unauthenticated } from "@/lib/apiAuth";
import { canReserveEquipment, canViewEvent, techSupportSeesEquipment } from "@/lib/permissions";
import { eventAllowsReserving, reservingClosedMessage } from "@/lib/equipmentAvailability";
import { loadSingleLineAvailability } from "@/lib/equipmentAvailabilityService";
import {
  adjustedNotification,
  adjustedStatus,
  checkAdjustment,
  checkRelease,
  releasedNotification,
} from "@/lib/equipmentReservation";
import { notifyUser } from "@/lib/notifications";
import { adjustReservationSchema } from "@/lib/validation";

// SPM-69 — Release or Adjust Equipment Reservation. Technical Support changes
// a reservation already made with Reserve (SPM-49): PATCH sets a new quantity
// (reduce or increase, AC2/AC3), DELETE releases it (AC1). The reservation goes;
// the Coordinator's requirement stays on the event, marked Released (AC8). The
// rules are in src/lib/equipmentReservation.ts.
//
// Same checks, in the same order, as the reserve route - 404 for an event the
// caller cannot see, then the role, then Planning only - and the same row
// lock on the equipment item, so an increase cannot race another reservation
// for the last unit. The assigned Coordinator is told in the same transaction
// (AC6).

type Context = { params: Promise<{ id: string; requestId: string }> };

type Access =
  | { refused: NextResponse }
  | {
      refused?: undefined;
      actorId: string;
      equipmentId: string;
      event: { id: string; title: string | null; coordinatorId: string | null };
    };

async function checkAccess(req: NextRequest, id: string, requestId: string): Promise<Access> {
  const actor = await getActor(req);
  if (!actor) return { refused: unauthenticated() };

  const eventId = await resolveEventId(id);
  const existing = eventId
    ? await prisma.equipmentRequest.findUnique({
        where: { id: requestId },
        select: {
          eventId: true,
          equipmentId: true,
          event: {
            select: {
              id: true,
              title: true,
              organiserId: true,
              organisationId: true,
              coordinatorId: true,
              status: true,
            },
          },
        },
      })
    : null;
  if (!existing || existing.eventId !== eventId || !canViewEvent(actor, existing.event)) {
    return { refused: hidden() };
  }
  if (!canReserveEquipment(actor)) {
    return { refused: forbidden("Only Technical Support Staff can change equipment reservations") };
  }
  if (!techSupportSeesEquipment(existing.event.status)) return { refused: hidden() };
  if (!eventAllowsReserving(existing.event.status)) {
    return { refused: NextResponse.json({ error: reservingClosedMessage(existing.event.status) }, { status: 400 }) };
  }
  return { actorId: actor.id, equipmentId: existing.equipmentId, event: existing.event };
}

/// Locks the equipment item and reads the line's fresh availability inside
/// that lock, as reserving does.
async function lockAndLoad(tx: Prisma.TransactionClient, equipmentId: string, requestId: string) {
  await tx.$queryRaw`SELECT id FROM equipment WHERE id = ${equipmentId} FOR UPDATE`;
  const line = await loadSingleLineAvailability(tx, requestId);
  if (!line) throw new RouteError(400, "This request no longer exists.");
  return line;
}

const LINE_INCLUDE = {
  equipment: { select: { id: true, name: true, category: true } },
  session: { select: { id: true, label: true, startsAt: true, endsAt: true } },
} as const;

export async function PATCH(req: NextRequest, context: Context) {
  try {
    const { id, requestId } = await context.params;
    const access = await checkAccess(req, id, requestId);
    if (access.refused) return access.refused;

    const { quantity } = adjustReservationSchema.parse(await req.json());

    const updated = await prisma.$transaction(async (tx) => {
      const line = await lockAndLoad(tx, access.equipmentId, requestId);
      const refusal = checkAdjustment(
        { status: line.requestStatus, quantityRequested: line.quantityRequested, quantityReserved: line.quantityReserved },
        quantity,
        line.result?.available ?? null
      );
      if (refusal) throw new RouteError(400, refusal);

      const saved = await tx.equipmentRequest.update({
        where: { id: requestId },
        data: {
          quantityReserved: quantity,
          status: adjustedStatus(quantity, line.quantityRequested),
          reviewedBy: access.actorId,
          reviewedAt: new Date(),
        },
        include: LINE_INCLUDE,
      });
      if (access.event.coordinatorId) {
        await notifyUser(
          tx,
          access.event.coordinatorId,
          adjustedNotification({
            eventId: access.event.id,
            eventTitle: access.event.title,
            equipmentName: line.equipmentName,
            // v8 ignore next -- holdsStock() passed, so there is a quantity reserved
            from: line.quantityReserved ?? 0,
            to: quantity,
          })
        );
      }
      return saved;
    });
    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, context: Context) {
  try {
    const { id, requestId } = await context.params;
    const access = await checkAccess(req, id, requestId);
    if (access.refused) return access.refused;

    const updated = await prisma.$transaction(async (tx) => {
      const line = await lockAndLoad(tx, access.equipmentId, requestId);
      const refusal = checkRelease(line.requestStatus, line.quantityReserved);
      if (refusal) throw new RouteError(400, refusal);

      // quantityReserved is kept: it is the record of what this line held (AC8).
      const saved = await tx.equipmentRequest.update({
        where: { id: requestId },
        data: { status: "released", reviewedBy: access.actorId, reviewedAt: new Date() },
        include: LINE_INCLUDE,
      });
      if (access.event.coordinatorId) {
        await notifyUser(
          tx,
          access.event.coordinatorId,
          releasedNotification({
            eventId: access.event.id,
            eventTitle: access.event.title,
            equipmentName: line.equipmentName,
            // v8 ignore next -- checkRelease() passed, so there is a quantity reserved
            quantity: line.quantityReserved ?? 0,
          })
        );
      }
      return saved;
    });
    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  if (err instanceof RouteError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/// Thrown inside the transaction to carry an HTTP status back out - Prisma
/// rolls the transaction back on any thrown error, so a refusal writes nothing.
class RouteError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
