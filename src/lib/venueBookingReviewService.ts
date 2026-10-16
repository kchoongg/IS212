// SPM-43: the one place that loads what a booking decision is checked against.
// The rules themselves are pure and live in src/lib/venueBookingReview.ts;
// both the Booking Requests list (to flag a conflict before anyone clicks
// Approve) and the decision route (to refuse one) read venues through here,
// so the screen and the server cannot disagree about whether a room is free.

import type { Prisma } from "@prisma/client";
import { eventReference } from "@/lib/format";
import type { ReviewVenue } from "@/lib/venueBookingReview";

/// Each venue with its APPROVED bookings and its unavailability periods, by
/// id. Takes the caller's client so the decision route can read inside its
/// own transaction.
export async function loadReviewVenues(
  db: Prisma.TransactionClient,
  venueIds: string[]
): Promise<Map<string, ReviewVenue>> {
  const venues = await db.venue.findMany({
    where: { id: { in: venueIds } },
    select: {
      id: true,
      name: true,
      isActive: true,
      setupMinutes: true,
      teardownMinutes: true,
      bookings: {
        where: { status: "approved" },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          event: { select: { sequenceNumber: true, title: true } },
        },
      },
      unavailability: { select: { startsAt: true, endsAt: true, reason: true } },
    },
  });

  return new Map(
    venues.map(({ id, bookings, ...venue }) => [
      id,
      {
        ...venue,
        bookings: bookings.map(({ event, ...b }) => ({
          ...b,
          eventReference: eventReference(event.sequenceNumber),
          eventTitle: event.title,
        })),
      },
    ])
  );
}
