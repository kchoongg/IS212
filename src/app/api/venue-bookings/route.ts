import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { can } from "@/lib/permissions";
import { eventReference } from "@/lib/format";

// SPM-42 AC7: the pending venue booking requests Venue Staff review, for the
// read-only Booking Requests list (S-22). Approving and rejecting belong to
// the Venue Booking Approval story.

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
      event: { select: { sequenceNumber: true, title: true } },
      session: { select: { label: true } },
      venue: { select: { code: true, name: true, setupMinutes: true, teardownMinutes: true } },
    },
    orderBy: { startsAt: "asc" },
  });

  return NextResponse.json(
    bookings.map(({ event, ...b }) => ({
      ...b,
      event: { reference: eventReference(event.sequenceNumber), title: event.title },
    }))
  );
}
