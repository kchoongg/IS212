import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { can } from "@/lib/permissions";
import { eventReference } from "@/lib/format";
import { approvalConflict } from "@/lib/venueBookingReview";
import { loadReviewVenues } from "@/lib/venueBookingReviewService";

// The pending venue booking requests Venue Staff review, for the Booking
// Requests screen (S-22). SPM-42 AC7 built the list; SPM-43 adds the event
// information a decision needs (AC2) and, per request, whether approving it
// would clash (`conflict`) - the BPMN's "Review booking & check conflicts".
// Deciding one is PATCH /api/venue-bookings/[id].

export async function GET(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }
  if (!can(actor.role, "venue_booking:decide")) {
    return forbidden("Reviewing venue bookings is Venue Staff's role");
  }

  const bookings = await prisma.venueBooking.findMany({
    where: { status: "pending" },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      layoutName: true,
      requirementsNote: true,
      requestedAt: true,
      requester: { select: { fullName: true } },
      event: {
        select: {
          sequenceNumber: true,
          title: true,
          status: true,
          startsAt: true,
          endsAt: true,
          expectedAttendance: true,
          organisation: { select: { name: true } },
        },
      },
      session: { select: { label: true, startsAt: true, endsAt: true, expectedAttendance: true } },
      venue: {
        select: { id: true, code: true, name: true, setupMinutes: true, teardownMinutes: true, isActive: true },
      },
    },
    orderBy: { startsAt: "asc" },
  });

  const venues = await loadReviewVenues(prisma, [...new Set(bookings.map((b) => b.venue.id))]);

  return NextResponse.json(
    bookings.map(({ event, ...b }) => {
      const venue = venues.get(b.venue.id);
      return {
        ...b,
        event: {
          reference: eventReference(event.sequenceNumber),
          title: event.title,
          status: event.status,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          expectedAttendance: event.expectedAttendance,
          organisation: event.organisation?.name ?? null,
        },
        conflict: venue ? approvalConflict(venue, b) : null,
      };
    })
  );
}
