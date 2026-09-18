import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { canManageEquipmentRequests, canViewEvent } from "@/lib/permissions";
import { updateEquipmentRequestSchema } from "@/lib/validation";
import { isTerminalEventStatus } from "@/lib/statuses";
import { ZodError } from "zod";

// PATCH/DELETE one EquipmentRequest row within S-16 — SPM-47 AC6:
// "Equipment requirements can be updated during planning where authorised."
// Same authorisation as POST on the parent route: the Coordinator assigned to
// the event (src/lib/permissions.ts canManageEquipmentRequests).

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

    const existing = await loadRequest(id, requestId);
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
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }

  const existing = await loadRequest(id, requestId);
  if (!existing || !canViewEvent(actor, existing.event)) {
    return hidden();
  }
  if (!canManageEquipmentRequests(actor, existing.event)) {
    return forbidden("Only the assigned Coordinator can remove an equipment requirement");
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
