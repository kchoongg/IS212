import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { parseEventReference } from "@/lib/format";
import { EVENT_INFORMATION_STATUSES, canConfigureRegistration, canViewEvent } from "@/lib/permissions";
import { configureRegistrationSchema } from "@/lib/validation";

// Configure Event Registration (SPM-64): the assigned coordinator turns
// attendee registration on or off for an event. Same shape as Update Event
// Information (SPM-62, ../information/route.ts): 401, then 404 for an event
// the user may not see, then 403, then the status window, then validation.

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    const sequenceNumber = parseEventReference(id);
    const event = sequenceNumber === null ? null : await prisma.event.findUnique({ where: { sequenceNumber } });
    // An event the user may not see is 404, never 403 - a 403 would confirm it exists.
    if (!event || !canViewEvent(actor, event)) {
      return hidden();
    }
    if (!canConfigureRegistration(actor, event)) {
      return forbidden("Only the coordinator assigned to this event can change its registration settings");
    }
    if (!EVENT_INFORMATION_STATUSES.includes(event.status)) {
      return NextResponse.json(
        { error: "Registration settings can only be changed while the event is Approved, Planning or Confirmed." },
        { status: 400 }
      );
    }

    const data = configureRegistrationSchema.parse(await req.json());

    // Turning registration off keeps the saved capacity and period, so turning
    // it back on restores them (decided 2026-10-09).
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: {
        ...(data.registrationEnabled !== undefined ? { registrationEnabled: data.registrationEnabled } : {}),
      },
    });
    return NextResponse.json({ event: updated, flagged: [] });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
