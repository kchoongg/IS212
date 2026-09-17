import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { updateEquipmentRequestSchema } from "@/lib/validation";
import { isTerminalEventStatus } from "@/lib/statuses";
import { ZodError } from "zod";

// PATCH/DELETE one EquipmentRequest row within S-16 — SPM-47 AC6:
// "Equipment requirements can be updated during planning where authorised."
// Same authorisation as POST on the parent route: Coordinator only.

async function loadRequest(eventId: string, requestId: string) {
  const request = await prisma.equipmentRequest.findUnique({
    where: { id: requestId },
    include: { event: { select: { id: true, status: true } } },
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
    const session = getSession(req);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (session.role !== "coordinator") {
      return NextResponse.json(
        { error: "Only a Coordinator can update equipment requirements" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const data = updateEquipmentRequestSchema.parse(body);

    const existing = await loadRequest(id, requestId);
    if (!existing) {
      return NextResponse.json({ error: "Equipment request not found" }, { status: 404 });
    }
    if (isTerminalEventStatus(existing.event.status)) {
      return NextResponse.json(
        { error: "Cannot update equipment for a completed, cancelled, or rejected event" },
        { status: 400 }
      );
    }

    const updated = await prisma.equipmentRequest.update({
      where: { id: requestId },
      data: {
        quantityRequested: data.quantityRequested,
        technicalRequirements: data.technicalRequirements,
      },
      include: { equipment: { select: { id: true, name: true, category: true } } },
    });
    return NextResponse.json(updated);
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
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (session.role !== "coordinator") {
    return NextResponse.json(
      { error: "Only a Coordinator can remove an equipment requirement" },
      { status: 403 }
    );
  }

  const existing = await loadRequest(id, requestId);
  if (!existing) {
    return NextResponse.json({ error: "Equipment request not found" }, { status: 404 });
  }
  if (isTerminalEventStatus(existing.event.status)) {
    return NextResponse.json(
      { error: "Cannot update equipment for a completed, cancelled, or rejected event" },
      { status: 400 }
    );
  }

  await prisma.equipmentRequest.delete({ where: { id: requestId } });
  return new NextResponse(null, { status: 204 });
}
