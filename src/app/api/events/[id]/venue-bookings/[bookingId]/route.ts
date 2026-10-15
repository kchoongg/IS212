import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { canRequestVenueBooking, canViewEvent } from "@/lib/permissions";
import { eventReference, parseEventReference } from "@/lib/format";
import { changeVenueBookingSchema } from "@/lib/validation";
import { ONLY_ASSIGNED_TO_CHANGE, checkBookingChange, releaseNotification } from "@/lib/venueBookingChange";
import { notifyRole } from "@/lib/notifications";
import { CLOSE_REASONS } from "@/lib/safetyResolution";
import { closeSafetyCheckAfterChange } from "@/lib/safetyCheckClose";

// SPM-67, Withdraw or Release Venue Booking. The assigned Coordinator
// withdraws a pending request (AC1) or releases an approved booking (AC3),
// with an optional reason (AC5). Every rule about the booking lives in
// checkBookingChange() (src/lib/venueBookingChange.ts).
//
// What this never does: change any of the event's other bookings (SPM-81
// AC7), or the event - except that, while it waits for or holds a safety
// check, the change closes the check and returns it to Planning (SPM-88). The freed period needs no write either - only pending and
// approved bookings hold a venue (AC4), and the Venue tab offers a new request
// straight away (AC8).

function notFound() {
  return NextResponse.json({ error: "Booking not found" }, { status: 404 });
}

/// What the Venue tab shows for the changed booking - the fields
/// GET /api/events/[id]/venue-bookings returns for each booking.
const BOOKING_FIELDS = {
  id: true,
  status: true,
  startsAt: true,
  endsAt: true,
  layoutName: true,
  requestedAt: true,
  cancellationReason: true,
  session: { select: { id: true, label: true } },
  venue: { select: { id: true, code: true, name: true } },
} as const;

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; bookingId: string }> }
) {
  try {
    const { id, bookingId } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    const sequenceNumber = parseEventReference(id);
    const event =
      sequenceNumber === null
        ? null
        : await prisma.event.findUnique({
            where: { sequenceNumber },
            select: {
              id: true,
              sequenceNumber: true,
              title: true,
              status: true,
              organiserId: true,
              organisationId: true,
              coordinatorId: true,
            },
          });
    if (!event || !canViewEvent(actor, event)) {
      return hidden();
    }
    // AC9: the same person who may request a booking for this event.
    if (!canRequestVenueBooking(actor, event)) {
      return forbidden(ONLY_ASSIGNED_TO_CHANGE);
    }

    const data = changeVenueBookingSchema.parse(await req.json());

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const found = await tx.venueBooking.findFirst({
        where: { id: bookingId, eventId: event.id },
        select: { venueId: true },
      });
      if (!found) {
        return { notFound: true } as const;
      }

      // The same lock Venue Staff's decision takes (PATCH /api/venue-bookings/[id]),
      // so a withdrawal and an approval of one request cannot both succeed:
      // whichever comes second reads the first one's status and is refused.
      await tx.$queryRaw`SELECT id FROM venues WHERE id = ${found.venueId} FOR UPDATE`;

      const booking = await tx.venueBooking.findUniqueOrThrow({
        where: { id: bookingId },
        select: {
          status: true,
          startsAt: true,
          endsAt: true,
          session: { select: { label: true } },
          venue: { select: { name: true, code: true } },
        },
      });

      const check = checkBookingChange({ action: data.action, bookingStatus: booking.status, eventStatus: event.status });
      if (!check.ok) {
        return { error: check.error } as const;
      }

      const reason = data.reason ?? null;
      const updated = await tx.venueBooking.update({
        where: { id: bookingId },
        data: { status: check.status, cancelledBy: actor.id, cancelledAt: new Date(), cancellationReason: reason },
        select: BOOKING_FIELDS,
      });

      // AC7: only a release is announced. A withdrawn request was never
      // decided, and simply leaves Venue Staff's list (AC2). Venue Staff are
      // not scoped by venue (#66), so all of them are told.
      if (data.action === "release") {
        const coordinator = await tx.user.findUnique({ where: { id: actor.id }, select: { fullName: true } });
        await notifyRole(
          tx,
          "venue_staff",
          releaseNotification({
            coordinatorName: coordinator?.fullName ?? "The assigned Coordinator",
            venueName: booking.venue.name,
            venueCode: booking.venue.code,
            eventId: event.id,
            eventReference: eventReference(event.sequenceNumber),
            eventTitle: event.title,
            sessionLabel: booking.session?.label ?? null,
            startsAt: booking.startsAt,
            endsAt: booking.endsAt,
            reason,
          })
        );
      }

      const safetyCheckClosed = await closeSafetyCheckAfterChange(
        tx,
        event,
        actor.id,
        data.action === "release" ? CLOSE_REASONS.bookingReleased : CLOSE_REASONS.bookingWithdrawn,
        false
      );

      return { booking: updated, safetyCheckClosed } as const;
    });

    if ("notFound" in result) {
      return notFound();
    }
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ...result.booking, safetyCheckClosed: result.safetyCheckClosed });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
