import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { can } from "@/lib/permissions";
import { createVenueSchema } from "@/lib/validation";
import { ZodError } from "zod";

export async function GET(req: NextRequest) {
  // ADDED: this route had no authentication at all. The venue catalogue is
  // internal operational information - "characteristics needed by Event
  // Coordinators and Venue Staff" (Week 4 core features) - so it is not
  // served to an anonymous caller, an organiser, or an attendee.
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }
  if (!can(actor.role, "venue:view")) {
    return forbidden("The venue catalogue is for ConnectSphere staff");
  }

  // ADDED: retired venues are out of the catalogue by default. Now that a
  // venue can be retired (PATCH /api/venues/[id] with isActive: false), an
  // unfiltered list would keep offering a closed room to suitability checks
  // and booking requests - which would make retiring it mean nothing.
  // `?includeRetired=true` is for the venue management screen, which has to
  // show a retired room in order to bring it back.
  const includeRetired = req.nextUrl.searchParams.get("includeRetired") === "true";

  // CHANGED: include layouts and facilities. A venue without its per-layout
  // capacities cannot answer "does this fit 100 people?", which is the whole
  // point of the venue list for suitability checking.
  const venues = await prisma.venue.findMany({
    where: includeRetired ? undefined : { isActive: true },
    include: {
      layouts: true,
      facilities: { include: { facility: true } },
    },
  });
  return NextResponse.json(venues);
}

export async function POST(req: NextRequest) {
  try {
    // ADDED: this route accepted unauthenticated requests - anyone at all
    // could add a venue to the catalogue. Venue Staff "are responsible for
    // venue information" (briefing §3), so it is theirs.
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    if (!can(actor.role, "venue:manage")) {
      return forbidden("Only Venue Staff can add a venue");
    }

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
