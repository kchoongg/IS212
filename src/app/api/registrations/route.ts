import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { createRegistrationSchema } from "@/lib/validation";
import { ZodError } from "zod";

export async function POST(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const data = createRegistrationSchema.parse(body);

    const event = await prisma.event.findUnique({ where: { id: data.eventId } });
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    if (event.status !== "confirmed") {
      return NextResponse.json({ error: "Event is not open for registration yet" }, { status: 400 });
    }
    if (!event.registrationEnabled) {
      return NextResponse.json({ error: "Registration is not enabled for this event" }, { status: 400 });
    }

    const registration = await prisma.registration.create({
      data: {
        eventId: data.eventId,
        attendeeId: session.id,
        dietaryNeeds: data.dietaryNeeds,
        accessibilityNeeds: data.accessibilityNeeds,
        status: "registered",
      },
    });

    return NextResponse.json(registration, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    // Unique constraint = already registered for this event
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "Already registered for this event" }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
