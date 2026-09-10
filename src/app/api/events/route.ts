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
  const events = await prisma.event.findMany({ where, orderBy: { createdAt: "desc" } });
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
        status: "draft",
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
