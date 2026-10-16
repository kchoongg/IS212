import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { can } from "@/lib/permissions";
import { changeHoldExpirySchema } from "@/lib/validation";
import { checkHoldExpiryChange } from "@/lib/holdExpiry";
import { expireDueHolds } from "@/lib/holdExpiryService";

/**
 * SPM-82 (AC3) — Venue Staff change a tentative hold's expiry while it is
 * still active: any time from now up to the start of the event (AC2). The
 * rules are checkHoldExpiryChange() in src/lib/holdExpiry.ts.
 *
 * Moving the expiry clears the "about to expire" warning, so the Coordinator
 * is warned again ahead of the new time (AC9).
 */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    if (!can(actor.role, "venue_booking:decide")) {
      return forbidden("Changing a hold's expiry is Venue Staff's role");
    }
    const { holdExpiresAt } = changeHoldExpirySchema.parse(await req.json());

    // A hold whose time has just run out is read as expired, and refused.
    await expireDueHolds();
    const booking = await prisma.venueBooking.findUnique({
      where: { id },
      select: { id: true, status: true, holdExpiresAt: true, event: { select: { startsAt: true } } },
    });
    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const check = checkHoldExpiryChange({
      status: booking.status,
      newExpiry: holdExpiresAt,
      eventStartsAt: booking.event.startsAt,
      now: new Date(),
    });
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }

    const updated = await prisma.venueBooking.update({
      where: { id },
      data: { holdExpiresAt, expiryWarningSentAt: null },
      select: { id: true, holdExpiresAt: true },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
