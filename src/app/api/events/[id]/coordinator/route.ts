import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { parseEventReference } from "@/lib/format";
import { statusLabel } from "@/lib/statuses";
import { ASSIGNABLE_STATUSES, can, canAssignCoordinator } from "@/lib/permissions";
import { assignCoordinatorSchema } from "@/lib/validation";
import { notifyUser } from "@/lib/notifications";
import { LEAD_ONLY_MESSAGE } from "@/lib/coordinatorAssignments";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { canViewEventWithHistory } from "@/lib/eventVisibility";

/**
 * SPM-30 — assign or reassign an event's Event Coordinator.
 *
 *   PUT /api/events/EVT-000123/coordinator   { coordinatorId }
 *
 * One endpoint for both, told apart by whether the event already has one:
 *   - assign:   a submitted event with no coordinator. Moves it to
 *               under_review in the same transaction (confirmed 2026-09-28).
 *   - reassign: a live event (REASSIGNABLE_STATUSES) that has one. Status is
 *               left alone - the event is mid-flight, only its owner changes.
 *
 * Only the Event Coordinator Lead - the Event Operations Manager until SPM-84
 * (clarifications #94, #101). Reassignment
 * approval happens outside the system (#94), and the coordinator does not
 * accept or decline (#95), so the change takes effect immediately.
 *
 * Notifies the new coordinator, and on reassignment the previous one too; the
 * organiser is not notified (confirmed 2026-09-28).
 */
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    const sequenceNumber = parseEventReference(id);
    const event =
      sequenceNumber === null
        ? null
        : await prisma.event.findUnique({
            where: { sequenceNumber },
            include: { coordinator: { select: { id: true, fullName: true } } },
          });
    // Same order as every other event route: an event the user cannot see is
    // 404 before any role check, so its existence is never confirmed.
    if (!event || !(await canViewEventWithHistory(actor, event))) {
      return hidden();
    }
    if (!can(actor.role, "event:assign_coordinator")) {
      return forbidden(LEAD_ONLY_MESSAGE);
    }
    if (!canAssignCoordinator(actor, event)) {
      return NextResponse.json(
        {
          error: event.coordinatorId
            ? `This event is ${statusLabel(event.status)} and its coordinator can no longer be changed.`
            : `Only a submitted event can be assigned a coordinator. This event is ${statusLabel(event.status)}.`,
        },
        { status: 400 }
      );
    }

    const data = assignCoordinatorSchema.parse(await req.json());

    if (data.coordinatorId === event.coordinatorId) {
      return NextResponse.json(
        { error: `${event.coordinator?.fullName ?? "This person"} is already the assigned coordinator.` },
        { status: 400 }
      );
    }

    const coordinator = await prisma.user.findUnique({
      where: { id: data.coordinatorId },
      select: { id: true, fullName: true, role: true, isActive: true },
    });
    if (!coordinator || coordinator.role !== "coordinator" || !coordinator.isActive) {
      return NextResponse.json(
        {
          error: "Choose an active Event Coordinator.",
          details: { fieldErrors: { coordinatorId: ["Choose an active Event Coordinator."] } },
        },
        { status: 400 }
      );
    }

    const previous = event.coordinator;
    const isFirstAssignment = ASSIGNABLE_STATUSES.includes(event.status) && !previous;
    const title = event.title ?? "Untitled event";

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Conditional on the coordinator and status we checked above, so two Ops
      // Managers acting on the same row at once cannot silently overwrite each
      // other - the second gets P2025 (below) instead.
      const e = await tx.event.update({
        where: { id: event.id, coordinatorId: event.coordinatorId, status: event.status },
        data: {
          coordinatorId: coordinator.id,
          ...(isFirstAssignment ? { status: "under_review" } : {}),
        },
        include: { coordinator: { select: { id: true, fullName: true } } },
      });

      if (isFirstAssignment) {
        await tx.eventStatusHistory.create({
          data: {
            eventId: event.id,
            fromStatus: event.status,
            toStatus: "under_review",
            changedBy: actor.id,
            reason: `Coordinator assigned: ${coordinator.fullName}`,
          },
        });
      }

      await notifyUser(tx, coordinator.id, {
        type: "coordinator_assigned",
        title: "You have been assigned an event",
        body: `You are now the coordinator for "${title}".`,
        eventId: event.id,
      });
      if (previous) {
        await notifyUser(tx, previous.id, {
          type: "coordinator_unassigned",
          title: "An event has been reassigned",
          body: `"${title}" has been reassigned to ${coordinator.fullName}. You are no longer its coordinator.`,
          eventId: event.id,
        });
      }

      return e;
    });

    return NextResponse.json({
      sequenceNumber: updated.sequenceNumber,
      status: updated.status,
      coordinator: updated.coordinator,
      previousCoordinator: previous,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Choose a coordinator.", details: err.flatten() }, { status: 400 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json(
        { error: "Someone else changed this event's coordinator just now. Reload to see the latest." },
        { status: 409 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
