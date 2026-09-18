import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { can, canManageEquipmentRequests, canViewEvent } from "@/lib/permissions";
import { addEquipmentRequestSchema } from "@/lib/validation";
import { equipmentWindowFor } from "@/lib/equipment";
import { isTerminalEventStatus } from "@/lib/statuses";
import { ZodError } from "zod";

// S-16 — the Event Coordinator's equipment requirements screen (SPM-47).
// GET is also how Technical Support and the Organiser see the same list
// (UI_DESIGN.md §4.3: the Equipment tab is read-only for them, "—" for Venue
// Staff and Attendee — they don't get the tab at all); only the Coordinator
// assigned to the event may add a row here (src/lib/permissions.ts
// canManageEquipmentRequests, SPM-4's role-and-relationship model).
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

  const event = await prisma.event.findUnique({ where: { id } });
  if (!event || !canViewEvent(actor, event)) {
    return hidden();
  }
  if (!can(actor.role, "equipment:view")) {
    return forbidden("Not authorised to view this event's equipment");
  }

  const requests = await prisma.equipmentRequest.findMany({
    where: { eventId: id },
    include: { equipment: { select: { id: true, name: true, category: true } } },
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

    const event = await prisma.event.findUnique({ where: { id } });
    if (!event || !canViewEvent(actor, event)) {
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
        { error: "Cannot record equipment for a completed, cancelled, or rejected event" },
        { status: 400 }
      );
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

    const created = await prisma.equipmentRequest.create({
      data: {
        eventId: id,
        equipmentId: data.equipmentId,
        quantityRequested: data.quantityRequested,
        technicalRequirements: data.technicalRequirements,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        requestedBy: actor.id,
        status: "requested",
      },
      include: { equipment: { select: { id: true, name: true, category: true } } },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    // @@unique([eventId, equipmentId]) — the same item requested twice.
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
