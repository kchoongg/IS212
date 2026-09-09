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

    const event = await prisma.event.create({
      data: {
        organiserId: session.id,
        title: data.title,
        category: data.category,
        purpose: data.purpose,
        description: data.description,
        proposedDate: data.proposedDate ? new Date(data.proposedDate) : undefined,
        timeSlot: data.timeSlot,
        expectedAttendance: data.expectedAttendance,
        accessibilityNeeds: data.accessibilityNeeds,
        registrationEnabled: data.registrationEnabled ?? false,
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
