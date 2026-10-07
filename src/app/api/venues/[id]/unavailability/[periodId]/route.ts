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
} from "@/lib/venueUnavailabilityService";
import { ZodError } from "zod";
import type { Prisma } from "@prisma/client";

const REFUSAL = "Only Venue Staff can mark a venue unavailable";

type Context = { params: Promise<{ id: string; periodId: string }> };

/// A refusal carried out of the transaction, so nothing is written before it.
const refuse = (error: string, status: number) => ({ error, status }) as const;

/// The venue and its period, or the refusal. A period reached through another
/// venue's address is "not found", the same as one that does not exist.
async function loadPeriod(tx: Prisma.TransactionClient, id: string, periodId: string) {
  const venue = await tx.venue.findUnique({ where: { id }, select: PERIOD_VENUE_SELECT });
  if (!venue) {
    return refuse("Venue not found", 404);
  }
  const period = await tx.venueUnavailability.findUnique({ where: { id: periodId } });
  if (!period || period.venueId !== id) {
    return refuse("Unavailable period not found", 404);
  }
  return { venue, period };
}

/**
 * Change an unavailable period's dates, slots or reason (SPM-45 AC5).
 *
 * Bookings the changed period newly covers are flagged and their coordinators
 * notified, exactly as when a period is first recorded. A booking the period
 * covered before is not flagged a second time, and one it no longer covers
 * keeps its flag: clearing a flag is the Coordinator's decision (SPM-68), not
 * a side effect of Venue Staff shortening a period.
 */
export async function PATCH(req: NextRequest, context: Context) {
  try {
    const { id, periodId } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    if (!can(actor.role, "venue:manage")) {
      return forbidden(REFUSAL);
    }

    const data = venueUnavailabilitySchema.parse(await req.json());
    const columns = periodColumns(data);

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const found = await loadPeriod(tx, id, periodId);
      if ("error" in found) {
        return found;
      }
      const { venue, period } = found;

      await tx.venueUnavailability.update({ where: { id: periodId }, data: columns });
      const flaggedBookings = await flagBookingsInPeriod(
        tx,
        venue,
        columns,
        periodBounds(columns),
        new Date(),
        { startsAt: period.startsAt, endsAt: period.endsAt }
      );

      return { period: periodJson({ ...columns, id: periodId }), flaggedBookings };
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * End an unavailable period early (SPM-45 AC5).
 *
 * A period under way ends now - its row is kept, with its end brought
 * forward, so the calendar still shows the slots the room really was out of
 * use. A period that has not started is removed outright, since it never took
 * effect. One that is already over has nothing left to end.
 *
 * Bookings are not touched and no flag is cleared (see PATCH above).
 */
export async function DELETE(req: NextRequest, context: Context) {
  try {
    const { id, periodId } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    if (!can(actor.role, "venue:manage")) {
      return forbidden(REFUSAL);
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const found = await loadPeriod(tx, id, periodId);
      if ("error" in found) {
        return found;
      }

      const now = new Date();
      const phase = periodPhase(found.period, now);
      if (phase === "past") {
        return refuse("This unavailable period is already over.", 400);
      }
      if (phase === "current") {
        await tx.venueUnavailability.update({ where: { id: periodId }, data: { endsAt: now } });
      } else {
        await tx.venueUnavailability.delete({ where: { id: periodId } });
      }
      return { ended: true } as const;
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
