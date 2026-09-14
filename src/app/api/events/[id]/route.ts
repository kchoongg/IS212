import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { updateEventStatusSchema } from "@/lib/validation";
import { ZodError } from "zod";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const event = await prisma.event.findUnique({
    where: { id },
    include: { facilityRequirements: { include: { facility: true } } },
  });
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

    // ADDED: a draft may be incomplete, but anything past draft may not.
    // The SQL design enforced this with a CHECK constraint; Prisma has no
    // equivalent, so the rule moves here - the one place status leaves draft.
    if (event.status === "draft" && data.status !== "draft") {
      const missing: string[] = [];
      if (!event.title) missing.push("title");
      if (!event.category) missing.push("category");
      if (!event.startsAt) missing.push("startsAt");
      if (!event.endsAt) missing.push("endsAt");
      if (event.expectedAttendance == null) missing.push("expectedAttendance");
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `Cannot submit an incomplete event. Missing: ${missing.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // ADDED: the brief requires a rejected request to retain the decision reason.
    if (data.status === "rejected" && !data.reason?.trim()) {
      return NextResponse.json(
        { error: "A reason is required when rejecting an event" },
        { status: 400 }
      );
    }

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const e = await tx.event.update({
        where: { id },
        data: {
          status: data.status,
          // Keep the decision record on the event itself as well as in history.
          ...(data.status === "rejected" ? { rejectionReason: data.reason } : {}),
          ...(data.status === "cancelled" ? { cancellationReason: data.reason } : {}),
          ...(data.status === "submitted" ? { submittedAt: new Date() } : {}),
          ...(data.status === "confirmed" ? { confirmedAt: new Date() } : {}),
        },
      });
      await tx.eventStatusHistory.create({
        data: {
          eventId: id,
          // CHANGED: oldStatus -> fromStatus, newStatus -> toStatus.
          fromStatus: event.status,
          toStatus: data.status,
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
