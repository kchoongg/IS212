import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { addEquipmentRequestSchema } from "@/lib/validation";
import { equipmentWindowFor } from "@/lib/equipment";
import { isTerminalEventStatus } from "@/lib/statuses";
import { ZodError } from "zod";

// S-16 — the Event Coordinator's equipment requirements screen (SPM-47).
// GET is also how Technical Support and the Organiser see the same list
// (UI_DESIGN.md §4.3: the Equipment tab is read-only for them, "—" for Venue
// Staff and Attendee — they don't get the tab at all); only the Coordinator
// may add a row here.
const CAN_VIEW_EQUIPMENT = ["organiser", "coordinator", "tech_support"];

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!CAN_VIEW_EQUIPMENT.includes(session.role)) {
    return NextResponse.json({ error: "Not authorised to view this event's equipment" }, { status: 403 });
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
    const session = getSession(req);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    // Only the Coordinator records equipment requirements once an event
    // exists — the Organiser's own chance to do this is at creation (S-08).
    if (session.role !== "coordinator") {
      return NextResponse.json(
        { error: "Only a Coordinator can record equipment requirements" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const data = addEquipmentRequestSchema.parse(body);

    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
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
        requestedBy: session.id,
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
