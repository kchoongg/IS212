import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { createEventSchema } from "@/lib/validation";
import { ZodError } from "zod";

export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Organisers see their own events; everyone else sees everything for now -
  // tighten this per role as the access model gets built out further.
  const where = session.role === "organiser" ? { organiserId: session.id } : {};
  const events = await prisma.event.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { facilityRequirements: { include: { facility: true } } },
  });
  return NextResponse.json(events);
}

export async function POST(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const data = createEventSchema.parse(body);

    // CHANGED: an event belongs to a client organisation, which is how access
    // is scoped ("an Organiser should not see events of unrelated clients").
    // Read it off the organiser rather than trusting the request body.
    const organiser = await prisma.user.findUnique({
      where: { id: session.id },
      select: { organisationId: true },
    });

    // ADDED: equipment is held wider than the event itself — kit leaves the
    // store before the doors open and comes back after they close. Two hours
    // either side is the default load-in / load-out window; Technical Support
    // adjusts it when they review the request.
    const LOAD_WINDOW_MS = 2 * 60 * 60 * 1000;
    const equipmentStartsAt = data.startsAt
      ? new Date(new Date(data.startsAt).getTime() - LOAD_WINDOW_MS)
      : null;
    const equipmentEndsAt = data.endsAt
      ? new Date(new Date(data.endsAt).getTime() + LOAD_WINDOW_MS)
      : null;

    // The event and its requirements are one thing to the organiser, so they
    // are one transaction here: a half-written request with facilities but no
    // equipment would be worse than a failure they can retry.
    const event = await prisma.event.create({
      data: {
        organiserId: session.id,
        organisationId: organiser?.organisationId ?? null,
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
        // event dates, so these two are non-null whenever the array is set.
        equipmentRequests:
          data.equipment?.length && equipmentStartsAt && equipmentEndsAt
            ? {
                create: data.equipment.map((item) => ({
                  equipmentId: item.equipmentId,
                  quantityRequested: item.quantityRequested,
                  technicalRequirements: item.technicalRequirements,
                  startsAt: equipmentStartsAt,
                  endsAt: equipmentEndsAt,
                  requestedBy: session.id,
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
