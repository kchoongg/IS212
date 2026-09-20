import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { can, eventListWhere, visibleEventsFor } from "@/lib/permissions";
import { createEventSchema } from "@/lib/validation";
import { equipmentWindowFor } from "@/lib/equipment";
import { ZodError } from "zod";

export async function GET(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }

  // CHANGED: the scoping rule moved to src/lib/permissions.ts, where it is
  // unit tested and stated once. It now covers the whole of briefing §8b, not
  // just drafts: an organiser sees their own events plus their client
  // organisation's submitted ones (never a colleague's private draft), an
  // attendee sees only confirmed events open for registration, and internal
  // staff see everything except drafts.
  const events = await prisma.event.findMany({
    where: eventListWhere(actor),
    orderBy: { createdAt: "desc" },
    include: { facilityRequirements: { include: { facility: true } } },
  });

  // An attendee gets the public subset of each event, not the whole record.
  return NextResponse.json(visibleEventsFor(actor, events));
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    // ADDED: raising an event request is the Event Organiser's job (briefing
    // §5 Step 1). Nobody else may create one on their own behalf.
    if (!can(actor.role, "event:create")) {
      return forbidden("Only an Event Organiser can raise an event request");
    }

    const body = await req.json();
    const data = createEventSchema.parse(body);

    // ADDED: equipment is held wider than the event itself — kit leaves the
    // store before the doors open and comes back after they close. Two hours
    // either side is the default load-in / load-out window; Technical Support
    // adjusts it when they review the request.
    const window = equipmentWindowFor(
      data.startsAt ? new Date(data.startsAt) : null,
      data.endsAt ? new Date(data.endsAt) : null
    );

    // The event and its requirements are one thing to the organiser, so they
    // are one transaction here: a half-written request with facilities but no
    // equipment would be worse than a failure they can retry.
    const event = await prisma.event.create({
      data: {
        organiserId: actor.id,
        // An event belongs to a client organisation, which is how access is
        // scoped ("an Organiser should not see events of unrelated clients").
        // It comes from the signed-in user, never from the request body.
        organisationId: actor.organisationId,
        title: data.title,
        category: data.category,
        purpose: data.purpose,
        description: data.description,
        // CHANGED: proposedDate + timeSlot -> real startsAt / endsAt timestamps.
        startsAt: data.startsAt ? new Date(data.startsAt) : undefined,
        endsAt: data.endsAt ? new Date(data.endsAt) : undefined,
        expectedAttendance: data.expectedAttendance,
        preferredLayout: data.preferredLayout,
        // CHANGED: accessibilityNeeds -> accessibilityNotes.
        accessibilityNotes: data.accessibilityNotes,
        specialRequirements: data.specialRequirements,
        registrationEnabled: data.registrationEnabled ?? false,
        registrationCapacity: data.registrationCapacity,
        registrationOpensAt: data.registrationOpensAt ? new Date(data.registrationOpensAt) : undefined,
        registrationClosesAt: data.registrationClosesAt ? new Date(data.registrationClosesAt) : undefined,
        status: "draft",

        // Stored as rows, not prose, so venue suitability can match them.
        // Everything an organiser ticks is mandatory; the nice-to-have case
        // (isMandatory: false) is a coordinator refinement, not an organiser
        // one, so it is not exposed on this form.
        facilityRequirements: data.facilityIds?.length
          ? {
              create: data.facilityIds.map((facilityId) => ({
                facilityId,
                isMandatory: true,
              })),
            }
          : undefined,

        // Guarded by createEventSchema: equipment cannot be requested without
        // event dates, so `window` is non-null whenever the array is set.
        equipmentRequests:
          data.equipment?.length && window
            ? {
                create: data.equipment.map((item) => ({
                  equipmentId: item.equipmentId,
                  quantityRequested: item.quantityRequested,
                  technicalRequirements: item.technicalRequirements,
                  startsAt: window.startsAt,
                  endsAt: window.endsAt,
                  requestedBy: actor.id,
                  status: "requested",
                })),
              }
            : undefined,
      },
      include: {
        facilityRequirements: { select: { facilityId: true, isMandatory: true } },
        equipmentRequests: {
          select: { id: true, equipmentId: true, quantityRequested: true, status: true },
        },
      },
    });

    return NextResponse.json(event, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
