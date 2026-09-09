import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { updateEventStatusSchema } from "@/lib/validation";
import { ZodError } from "zod";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  return NextResponse.json(event);
}

/**
 * Updates an event's status - this is the one endpoint that has to respect
 * the BPMN status lifecycle, not just accept any value. See
 * docs/ConnectSphere_Status_Lifecycle.drawio for the full set of valid
 * transitions; this is a minimal starting guard, not the full rule set yet.
 */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const session = getSession(req);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const data = updateEventStatusSchema.parse(body);

    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const e = await tx.event.update({ where: { id }, data: { status: data.status } });
      await tx.eventStatusHistory.create({
        data: {
          eventId: id,
          oldStatus: event.status,
          newStatus: data.status,
          changedBy: session.id,
          reason: data.reason,
        },
      });
      return e;
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
