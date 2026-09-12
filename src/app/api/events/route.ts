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

    // ADDED: facility-based venue/accessibility requirements reference the
    // shared Facility catalogue by id - check they actually exist so a typo
    // fails with a 400 here rather than a raw FK error from Prisma.
    if (data.facilityRequirements && data.facilityRequirements.length > 0) {
      const ids = data.facilityRequirements.map((f) => f.facilityId);
      const found = await prisma.facility.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const foundIds = new Set(found.map((f) => f.id));
      const unknown = ids.filter((id) => !foundIds.has(id));
      if (unknown.length > 0) {
        return NextResponse.json(
          { error: `Unknown facility id(s): ${unknown.join(", ")}` },
          { status: 400 }
        );
      }
    }

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
        equipmentNotes: data.equipmentNotes,
        specialRequirements: data.specialRequirements,
        registrationEnabled: data.registrationEnabled ?? false,
        registrationCapacity: data.registrationCapacity,
        registrationOpensAt: data.registrationOpensAt ? new Date(data.registrationOpensAt) : undefined,
        registrationClosesAt: data.registrationClosesAt ? new Date(data.registrationClosesAt) : undefined,
        status: "draft",
        ...(data.facilityRequirements && data.facilityRequirements.length > 0
          ? {
              facilityRequirements: {
                create: data.facilityRequirements.map((f) => ({
                  facilityId: f.facilityId,
                  isMandatory: f.isMandatory ?? true,
                })),
              },
            }
          : {}),
      },
      include: { facilityRequirements: { include: { facility: true } } },
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
