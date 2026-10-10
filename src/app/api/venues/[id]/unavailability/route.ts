import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { can } from "@/lib/permissions";
import { venueUnavailabilitySchema } from "@/lib/validation";
import { periodBounds, periodPhase } from "@/lib/venueUnavailability";
import {
  PERIOD_VENUE_SELECT,
  flagBookingsInPeriod,
  periodColumns,
  periodJson,
  periodOverResponse,
} from "@/lib/venueUnavailabilityService";
import { ZodError } from "zod";
import type { Prisma } from "@prisma/client";

const REFUSAL = "Only Venue Staff can mark a venue unavailable";

function venueNotFound() {
  return NextResponse.json({ error: "Venue not found" }, { status: 404 });
}

/**
 * A venue's unavailable periods that are not over yet, earliest first - what
 * the venue editor lists (SPM-45). A period that has passed is not returned:
 * the venue is simply available again (AC4), with nothing left to change or
 * end. The availability calendar reads past periods through its own endpoint.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    if (!can(actor.role, "venue:manage")) {
      return forbidden(REFUSAL);
    }

    const venue = await prisma.venue.findUnique({ where: { id }, select: { id: true } });
    if (!venue) {
      return venueNotFound();
    }

    const periods = await prisma.venueUnavailability.findMany({
      where: { venueId: id, endsAt: { gt: new Date() } },
      orderBy: { startsAt: "asc" },
    });
    return NextResponse.json(periods.map(periodJson));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Mark a venue unavailable for a period (SPM-45; Week 7 Change #2).
 *
 * Writes one VenueUnavailability row and nothing on the venue itself: the room
 * stays active and in the catalogue, and is closed only for the time the
 * period covers. The calendar, venue search and the booking checks already
 * read that table, so they need nothing more to respect it - and the venue is
 * "available again without any action" (AC4) simply because a period that has
 * passed no longer overlaps anything.
 *
 * The period is never refused for the bookings it lands on ("this may occur
 * even when future events have already been booked"). Those are flagged for
 * review and their coordinators notified; the response says which. The one
 * period that is refused is one already over, which could never be listed or
 * flag anything.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    if (!can(actor.role, "venue:manage")) {
      return forbidden(REFUSAL);
    }

    const data = venueUnavailabilitySchema.parse(await req.json());
    const columns = periodColumns(data);
    if (periodPhase(columns, new Date()) === "past") {
      return periodOverResponse();
    }

    // One transaction, so a period is never saved without its flags and
    // notifications, or the other way round.
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const venue = await tx.venue.findUnique({ where: { id }, select: PERIOD_VENUE_SELECT });
      if (!venue) {
        return null;
      }

      const created = await tx.venueUnavailability.create({
        data: { venueId: id, ...columns, createdBy: actor.id },
      });
      const flaggedBookings = await flagBookingsInPeriod(tx, venue, columns, periodBounds(columns), new Date());

      return { period: periodJson({ ...columns, id: created.id }), flaggedBookings };
    });

    if (!result) {
      return venueNotFound();
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
