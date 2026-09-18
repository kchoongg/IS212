import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { can, canViewEvent } from "@/lib/permissions";
import { createRegistrationSchema } from "@/lib/validation";
import { ZodError } from "zod";

export async function POST(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    // ADDED: registering is the Attendee's action (briefing §5 Step 11). A
    // coordinator or venue staff member signing themselves up as an attendee
    // would put a planning account into the attendee list.
    if (!can(actor.role, "registration:create")) {
      return forbidden("Only an Attendee can register for an event");
    }

    const body = await req.json();
    const data = createRegistrationSchema.parse(body);

    const event = await prisma.event.findUnique({ where: { id: data.eventId } });
    if (!event) {
      return hidden();
    }
    // ADDED: an event the attendee cannot see cannot be registered for
    // either - registering would otherwise confirm that a hidden event
    // exists. The business rules below (confirmed, in window, seats left)
    // still apply on top of this.
    if (!canViewEvent(actor, event)) {
      return hidden();
    }
    if (event.status !== "confirmed") {
      return NextResponse.json({ error: "Event is not open for registration yet" }, { status: 400 });
    }
    if (!event.registrationEnabled) {
      return NextResponse.json({ error: "Registration is not enabled for this event" }, { status: 400 });
    }

    // ADDED: registration window, if one is set.
    const now = new Date();
    if (event.registrationOpensAt && now < event.registrationOpensAt) {
      return NextResponse.json({ error: "Registration has not opened yet" }, { status: 400 });
    }
    if (event.registrationClosesAt && now > event.registrationClosesAt) {
      return NextResponse.json({ error: "Registration has closed" }, { status: 400 });
    }

    // The @@unique([eventId, attendeeId]) constraint means a withdrawn attendee
    // cannot simply INSERT again. Reactivate their existing row instead, so
    // withdrawing and re-registering both work (user stories 19 and 20).
    const existing = await prisma.registration.findUnique({
      where: { eventId_attendeeId: { eventId: data.eventId, attendeeId: actor.id } },
    });
    if (existing && existing.status !== "withdrawn") {
      return NextResponse.json({ error: "Already registered for this event" }, { status: 400 });
    }

    // ADDED: capacity check. Counted inside the transaction below so two
    // attendees claiming the last seat at the same time cannot both succeed.
    const registration = await prisma.$transaction(async (tx) => {
      if (event.registrationCapacity != null) {
        const taken = await tx.registration.count({
          where: { eventId: data.eventId, status: { in: ["registered", "attended"] } },
        });
        if (taken >= event.registrationCapacity) {
          throw new Error("EVENT_FULL");
        }
      }

      if (existing) {
        return tx.registration.update({
          where: { id: existing.id },
          data: {
            status: "registered",
            registeredAt: new Date(),
            withdrawnAt: null,
            // CHANGED: dietaryNeeds -> dietaryRequirements,
            //          accessibilityNeeds -> accessibilityRequirements.
            dietaryRequirements: data.dietaryRequirements,
            accessibilityRequirements: data.accessibilityRequirements,
          },
        });
      }

      return tx.registration.create({
        data: {
          eventId: data.eventId,
          attendeeId: actor.id,
          dietaryRequirements: data.dietaryRequirements,
          accessibilityRequirements: data.accessibilityRequirements,
          status: "registered",
        },
      });
    });

    return NextResponse.json(registration, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    if (err instanceof Error && err.message === "EVENT_FULL") {
      return NextResponse.json({ error: "This event is full" }, { status: 400 });
    }
    // Unique constraint = already registered for this event. Kept as a backstop
    // for the race where two requests pass the check above simultaneously.
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "Already registered for this event" }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
