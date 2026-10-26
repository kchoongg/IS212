import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, resolveEventId, unauthenticated } from "@/lib/apiAuth";
import { canManageEquipmentRequests, canViewEvent } from "@/lib/permissions";
import { updateEquipmentRequestSchema } from "@/lib/validation";
import { CLOSED_EVENT_STATUSES_PHRASE, isBeforeApproval, isTerminalEventStatus } from "@/lib/statuses";
import { PLANNING_REASONS, beginPlanningIfApproved, revertConfirmationIfConfirmed } from "@/lib/beginPlanning";
import { CLOSE_REASONS } from "@/lib/safetyResolution";
import { closeSafetyCheckAfterChange } from "@/lib/safetyCheckClose";
import { sendBackChanges } from "@/lib/equipmentReservation";
import { ZodError } from "zod";

// PATCH/DELETE one EquipmentRequest row within S-16 — SPM-47 AC6:
// "Equipment requirements can be updated during planning where authorised."
// Same authorisation as POST on the parent route: the Coordinator assigned to
// the event (src/lib/permissions.ts canManageEquipmentRequests).

// CHANGED (SPM-31): callers pass the event's real id here (resolved from the
// route's "EVT-000123" segment via resolveEventId() first), never the route
// segment itself - see the comment on resolveEventId() in src/lib/apiAuth.ts.
async function loadRequest(eventId: string, requestId: string) {
  const request = await prisma.equipmentRequest.findUnique({
    where: { id: requestId },
    include: {
      event: {
        select: {
          id: true,
          organiserId: true,
          organisationId: true,
          coordinatorId: true,
          status: true,
          registrationEnabled: true,
        },
      },
    },
  });
  if (!request || request.eventId !== eventId) return null;
  return request;
}

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
    const existing = eventId ? await loadRequest(eventId, requestId) : null;
    if (!existing || !canViewEvent(actor, existing.event)) {
      return hidden();
    }
    if (!canManageEquipmentRequests(actor, existing.event)) {
      return forbidden("Only the assigned Coordinator can update equipment requirements");
    }

    const body = await req.json();
    const data = updateEquipmentRequestSchema.parse(body);

    if (isTerminalEventStatus(existing.event.status)) {
      return NextResponse.json(
        { error: `Cannot update equipment for a ${CLOSED_EVENT_STATUSES_PHRASE} event` },
        { status: 400 }
      );
    }
    // ADDED (SPM-54): arrangements wait for approval.
    if (isBeforeApproval(existing.event.status)) {
      return NextResponse.json(
        { error: "Equipment can be recorded once this request has been approved" },
        { status: 400 }
      );
    }

    // sessionId is deliberately not editable here, same reasoning as
    // equipmentId: moving a requirement to a different session is "remove
    // this row, add another", not an edit.
    //
    // SPM-54: saving a change on an Approved event begins planning, in the same
    // transaction as the change.
    // SPM-62: on a Confirmed event it moves the event back to Planning instead.
    //
    // SPM-69 AC7: a change to a line that already has a reservation sends it
    // back to Technical Support as Requested. Its reservation is left exactly
    // as it was - quantityReserved still shows, and still holds, what was
    // reserved - and it is not flagged; Technical Support reviews it again.
    // A released line whose quantity changes goes back too, as a fresh request.
    const backToTechnicalSupport = sendBackChanges(existing, data);
    const { updated, planningStarted, confirmationReverted, safetyCheckClosed } = await prisma.$transaction(async (tx) => {
      const updated = await tx.equipmentRequest.update({
        where: { id: requestId },
        data: {
          quantityRequested: data.quantityRequested,
          technicalRequirements: data.technicalRequirements,
          ...backToTechnicalSupport,
        },
        include: {
          equipment: { select: { id: true, name: true, category: true } },
          session: { select: { id: true, label: true, startsAt: true, endsAt: true } },
        },
      });
      const planningStarted = await beginPlanningIfApproved(tx, existing.event, actor.id, PLANNING_REASONS.equipmentUpdated);
      const confirmationReverted = await revertConfirmationIfConfirmed(
        tx,
        existing.event,
        actor.id,
        PLANNING_REASONS.equipmentUpdated
      );
      // SPM-88: and closes the safety check it rests on.
      const safetyCheckClosed = await closeSafetyCheckAfterChange(
        tx,
        existing.event,
        actor.id,
        CLOSE_REASONS.equipment,
        confirmationReverted
      );
      return { updated, planningStarted, confirmationReverted, safetyCheckClosed };
    });
    return NextResponse.json({ ...updated, planningStarted, confirmationReverted, safetyCheckClosed });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string; requestId: string }> }
) {
  const { id, requestId } = await context.params;
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }

  const eventId = await resolveEventId(id);
  const existing = eventId ? await loadRequest(eventId, requestId) : null;
  if (!existing || !canViewEvent(actor, existing.event)) {
    return hidden();
  }
  if (!canManageEquipmentRequests(actor, existing.event)) {
    return forbidden("Only the assigned Coordinator can remove an equipment requirement");
  }
  if (isTerminalEventStatus(existing.event.status)) {
    return NextResponse.json(
      { error: `Cannot update equipment for a ${CLOSED_EVENT_STATUSES_PHRASE} event` },
      { status: 400 }
    );
  }
  if (isBeforeApproval(existing.event.status)) {
    return NextResponse.json(
      { error: "Equipment can be recorded once this request has been approved" },
      { status: 400 }
    );
  }

  // SPM-54: removing a row from an Approved event begins planning too, so this
  // answers with a body (was 204) to tell the screen when it did.
  // SPM-62: or, on a Confirmed event, moves it back to Planning.
  const { planningStarted, confirmationReverted, safetyCheckClosed } = await prisma.$transaction(async (tx) => {
    await tx.equipmentRequest.delete({ where: { id: requestId } });
    const planningStarted = await beginPlanningIfApproved(tx, existing.event, actor.id, PLANNING_REASONS.equipmentRemoved);
    const confirmationReverted = await revertConfirmationIfConfirmed(
      tx,
      existing.event,
      actor.id,
      PLANNING_REASONS.equipmentRemoved
    );
    // SPM-88: and closes the safety check it rests on.
    const safetyCheckClosed = await closeSafetyCheckAfterChange(
      tx,
      existing.event,
      actor.id,
      CLOSE_REASONS.equipment,
      confirmationReverted
    );
    return { planningStarted, confirmationReverted, safetyCheckClosed };
  });
  return NextResponse.json({ planningStarted, confirmationReverted, safetyCheckClosed });
}
