import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { canManageEquipmentRequests, canViewEquipmentRequests } from "@/lib/permissions";
import { addEquipmentRequestSchema } from "@/lib/validation";
import { equipmentWindowFor } from "@/lib/equipment";
import { CLOSED_EVENT_STATUSES_PHRASE, isBeforeApproval, isTerminalEventStatus } from "@/lib/statuses";
import { PLANNING_REASONS, beginPlanningIfApproved, revertConfirmationIfConfirmed } from "@/lib/beginPlanning";
import { CLOSE_REASONS } from "@/lib/safetyResolution";
import { closeSafetyCheckAfterChange } from "@/lib/safetyCheckClose";
import { parseEventReference } from "@/lib/format";
import { ZodError } from "zod";
import { canViewEventWithHistory } from "@/lib/eventVisibility";

// CHANGED (SPM-31): `id` here is the event's reference (e.g. "EVT-000123"),
// not its underlying UUID - see eventReference()/parseEventReference() in
// src/lib/format.ts. Resolve it once per request, then use the returned
// row's real `event.id` for anything that scopes a foreign key
// (EquipmentRequest.eventId), never the route segment itself.
async function resolveEvent(id: string) {
  const sequenceNumber = parseEventReference(id);
  return sequenceNumber === null ? null : prisma.event.findUnique({ where: { sequenceNumber } });
}

// S-16 — the Event Coordinator's equipment requirements screen (SPM-47).
// GET is Technical Support viewing what's been recorded (AC6, taken
// literally — confirmed 2026-09-19 not to extend to the Organiser); the
// assigned Coordinator sees it too, but only because canManageEquipmentRequests
// already requires that, not as a separate viewing right. Only the assigned
// Coordinator may add a row (src/lib/permissions.ts canManageEquipmentRequests,
// SPM-4's role-and-relationship model).
//
// Visibility is checked the same two-step way as GET /api/events/[id]: first
// canViewEvent() (can this user see the event at all — an event they cannot
// see is 404, never 403, so its existence is never confirmed), then the
// equipment-specific role check on top.

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }

  const event = await resolveEvent(id);
  if (!event || !(await canViewEventWithHistory(actor, event))) {
    return hidden();
  }
  if (!canViewEquipmentRequests(actor, event)) {
    return forbidden("Not authorised to view this event's equipment");
  }

  const requests = await prisma.equipmentRequest.findMany({
    where: { eventId: event.id },
    include: {
      equipment: { select: { id: true, name: true, category: true } },
      // ADDED: which session this requirement is scoped to, if any (SPM-47,
      // multi-session events — class clarification #74). Null on every row
      // until something actually creates an EventSession (SPM-25, schema
      // only so far).
      session: { select: { id: true, label: true, startsAt: true, endsAt: true } },
      // SPM-77 (AC3): the alternative Technical Support suggested that is
      // waiting for the Coordinator's decision, if any (at most one).
      suggestions: {
        where: { status: "pending" },
        orderBy: { suggestedAt: "desc" },
        take: 1,
        select: {
          id: true,
          quantity: true,
          note: true,
          suggestedAt: true,
          equipment: { select: { id: true, name: true } },
          suggester: { select: { fullName: true } },
        },
      },
    },
    orderBy: { requestedAt: "asc" },
  });
  return NextResponse.json(requests);
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    const event = await resolveEvent(id);
    if (!event || !(await canViewEventWithHistory(actor, event))) {
      return hidden();
    }
    // Only the Coordinator assigned to this event records equipment
    // requirements once it exists — the Organiser's own chance to do this is
    // at creation (S-08).
    if (!canManageEquipmentRequests(actor, event)) {
      return forbidden("Only the assigned Coordinator can record equipment requirements");
    }

    const body = await req.json();
    const data = addEquipmentRequestSchema.parse(body);

    if (isTerminalEventStatus(event.status)) {
      return NextResponse.json(
        { error: `Cannot record equipment for a ${CLOSED_EVENT_STATUSES_PHRASE} event` },
        { status: 400 }
      );
    }
    // ADDED (SPM-54): arrangements wait for approval.
    if (isBeforeApproval(event.status)) {
      return NextResponse.json(
        { error: "Equipment can be recorded once this request has been approved" },
        { status: 400 }
      );
    }

    // ADDED (SPM-47, multi-session events): a session, if given, has to
    // actually belong to this event — otherwise a coordinator on one event
    // could scope a requirement to a session of a completely different one.
    if (data.sessionId) {
      const session = await prisma.eventSession.findUnique({ where: { id: data.sessionId } });
      if (!session || session.eventId !== event.id) {
        return NextResponse.json({ error: "Session not found for this event" }, { status: 400 });
      }
    }

    // ADDED (SPM-48): a retired item cannot be requested. The picker no longer
    // lists it, but the server is what enforces it.
    const item = await prisma.equipment.findUnique({
      where: { id: data.equipmentId },
      select: { isActive: true },
    });
    if (item && !item.isActive) {
      return NextResponse.json({ error: "This equipment has been retired and can no longer be requested" }, { status: 400 });
    }

    // Mirrors createEventSchema: EquipmentRequest.startsAt / endsAt are NOT
    // NULL and are derived from the event's own times.
    const window = equipmentWindowFor(event.startsAt, event.endsAt);
    if (!window) {
      return NextResponse.json(
        { error: "Set the event date and time before requesting equipment" },
        { status: 400 }
      );
    }

    // SPM-54: the first equipment requirement recorded for an Approved event
    // begins planning, in the same transaction as the requirement itself.
    // SPM-62: on a Confirmed event it moves the event back to Planning instead.
    const { created, planningStarted, confirmationReverted, safetyCheckClosed } = await prisma.$transaction(async (tx) => {
      const created = await tx.equipmentRequest.create({
        data: {
          eventId: event.id,
          sessionId: data.sessionId,
          equipmentId: data.equipmentId,
          quantityRequested: data.quantityRequested,
          technicalRequirements: data.technicalRequirements,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          requestedBy: actor.id,
          status: "requested",
        },
        include: {
          equipment: { select: { id: true, name: true, category: true } },
          session: { select: { id: true, label: true, startsAt: true, endsAt: true } },
        },
      });
      const planningStarted = await beginPlanningIfApproved(tx, event, actor.id, PLANNING_REASONS.equipmentAdded);
      const confirmationReverted = await revertConfirmationIfConfirmed(tx, event, actor.id, PLANNING_REASONS.equipmentAdded);
      // SPM-88: and closes the safety check it rests on.
      const safetyCheckClosed = await closeSafetyCheckAfterChange(
        tx,
        event,
        actor.id,
        CLOSE_REASONS.equipment,
        confirmationReverted
      );
      return { created, planningStarted, confirmationReverted, safetyCheckClosed };
    });
    return NextResponse.json({ ...created, planningStarted, confirmationReverted, safetyCheckClosed }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    // @@unique([eventId, equipmentId]) — the same item requested twice.
    // NOTE: this constraint does not include sessionId (Postgres treats NULL
    // as distinct in a unique index, and a 3-column version would stop
    // deduplicating single-session events — the common case, where sessionId
    // is always null). So two different sessions of the same event cannot yet
    // each independently request the same equipment type — a documented,
    // known limitation of the schema (prisma/schema.prisma, EquipmentRequest),
    // not something this route can fix on its own.
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "This item is already requested for this event — update the existing row instead" },
        { status: 400 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
