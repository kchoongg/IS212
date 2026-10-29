import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { expireDueHolds } from "@/lib/holdExpiryService";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { can } from "@/lib/permissions";
import { decideVenueBookingSchema } from "@/lib/validation";
import { checkBookingDecision } from "@/lib/venueBookingReview";
import { loadReviewVenues } from "@/lib/venueBookingReviewService";
import { formatDateTimeRange, formatVenue } from "@/lib/format";
import { notifyUser } from "@/lib/notifications";

// SPM-43, Review Venue Booking Request: Venue Staff approve a pending request
// (AC3) or reject it with a reason (AC4, AC5) and, optionally, a suggested
// alternative for the coordinator to act on (AC6). Every rule lives in
// checkBookingDecision() (src/lib/venueBookingReview.ts).
//
// What this never does: change the event. An approved request is the confirmed
// booking (AC7) and nothing more - the event stays where it is until the
// coordinator confirms it (BPMN: venue approval joins the other planning
// branches first; #80). And a suggestion books nothing - the coordinator
// submits a new request (#45, #110).

function notFound() {
  return NextResponse.json({ error: "Booking request not found" }, { status: 404 });
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    // #66: Venue Staff are not scoped by venue, so the role is the whole check.
    if (!can(actor.role, "venue_booking:decide")) {
      return forbidden("Deciding venue bookings is Venue Staff's role");
    }

    const data = decideVenueBookingSchema.parse(await req.json());

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const found = await tx.venueBooking.findUnique({ where: { id }, select: { venueId: true } });
      if (!found) {
        return { notFound: true } as const;
      }

      // One decision per venue at a time. Without the lock, two requests for
      // the same time approved at the same moment would each pass the conflict
      // check before the other's approval was written (#35: double-booking is
      // blocked, not warned about). Everything below reads after the lock.
      await tx.$queryRaw`SELECT id FROM venues WHERE id = ${found.venueId} FOR UPDATE`;
      // SPM-82 (AC5): after the lock and before the booking is read, so a hold whose time has just run out is read as expired, not approved.
      await expireDueHolds(tx);

      const booking = await tx.venueBooking.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          status: true,
          venueId: true,
          startsAt: true,
          endsAt: true,
          event: { select: { id: true, status: true, title: true, coordinatorId: true } },
          venue: { select: { name: true, code: true } },
          session: { select: { label: true } },
        },
      });
      const venue = (await loadReviewVenues(tx, [booking.venueId])).get(booking.venueId)!;
      const suggestedVenue =
        data.decision === "reject" && data.suggestedVenueId
          ? await tx.venue.findUnique({
              where: { id: data.suggestedVenueId },
              select: { id: true, isActive: true },
            })
          : null;

      const check = checkBookingDecision({
        decision: data,
        booking,
        eventStatus: booking.event.status,
        venue,
        suggestedVenue,
      });
      if (!check.ok) {
        return { error: check.error, field: check.field } as const;
      }

      const updated = await tx.venueBooking.update({
        where: { id },
        data:
          data.decision === "approve"
            ? { status: "approved", decidedBy: actor.id, decidedAt: new Date() }
            : {
                status: "rejected",
                decidedBy: actor.id,
                decidedAt: new Date(),
                decisionReason: data.reason.trim(),
                suggestedVenueId: suggestedVenue?.id ?? null,
                suggestedAlternative: data.suggestedAlternative ?? null,
              },
        select: {
          id: true,
          status: true,
          decidedAt: true,
          decisionReason: true,
          suggestedAlternative: true,
          suggestedVenue: { select: { id: true, code: true, name: true } },
        },
      });

      // SPM-53 (AC9): the assigned coordinator hears the outcome, with the
      // venue, the times and a rejection's reason. Any suggestion stays on the
      // event's Venue tab (GET /api/events/[id]/venue-bookings).
      const { event } = booking;
      if (event.coordinatorId) {
        const approved = updated.status === "approved";
        const session = booking.session?.label ? ` (${booking.session.label})` : "";
        await notifyUser(tx, event.coordinatorId, {
          type: approved ? "venue_booking_approved" : "venue_booking_rejected",
          title: approved ? "Venue booking approved" : "Venue booking rejected",
          body:
            `${formatVenue(booking.venue.name, booking.venue.code)} for "${event.title ?? "Untitled event"}"${session} ` +
            `on ${formatDateTimeRange(booking.startsAt, booking.endsAt)} was ${approved ? "approved" : "rejected"}.` +
            (approved ? "" : ` Reason: ${updated.decisionReason}`),
          eventId: event.id,
        });
      }
      return { booking: updated } as const;
    });

    if ("notFound" in result) {
      return notFound();
    }
    if ("error" in result) {
      return NextResponse.json({ error: result.error, field: result.field }, { status: 400 });
    }
    return NextResponse.json(result.booking);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
