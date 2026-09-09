import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createVenueSchema } from "@/lib/validation";
import { ZodError } from "zod";

export async function GET() {
  // CHANGED: include layouts and facilities. A venue without its per-layout
  // capacities cannot answer "does this fit 100 people?", which is the whole
  // point of the venue list for suitability checking.
  const venues = await prisma.venue.findMany({
    include: {
      layouts: true,
      facilities: { include: { facility: true } },
    },
  });
  return NextResponse.json(venues);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = createVenueSchema.parse(body);

    // CHANGED: facilityIds and layouts are relations, not columns, so they are
    // pulled out before the rest is passed straight through to create().
    const { facilityIds, layouts, ...venueFields } = data;

    const existing = await prisma.venue.findUnique({ where: { code: venueFields.code } });
    if (existing) {
      return NextResponse.json({ error: "A venue with this code already exists" }, { status: 400 });
    }

    const venue = await prisma.venue.create({
      data: {
        ...venueFields,
        layouts: layouts?.length ? { create: layouts } : undefined,
        facilities: facilityIds?.length
          ? { create: facilityIds.map((facilityId) => ({ facilityId })) }
          : undefined,
      },
      include: {
        layouts: true,
        facilities: { include: { facility: true } },
      },
    });

    return NextResponse.json(venue, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
