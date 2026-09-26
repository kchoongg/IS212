// SPM-48 — loads what the availability rules need and runs them for one event.
// The rules are in equipmentAvailability.ts, the per-line assembly in
// equipmentAvailabilityLines.ts; this file only reads the database.

import { prisma } from "@/lib/prisma";
import { COMMITTING_REQUEST_STATUSES } from "@/lib/equipmentAvailability";
import {
  assembleLines,
  type EventAvailability,
  type OtherRequest,
  type RequestedLine,
} from "@/lib/equipmentAvailabilityLines";

// Bookings that say "this event is going to be at that venue". A rejected or
// cancelled booking does not; an approved one wins over a pending one.
const VENUE_CHOSEN_STATUSES = ["approved", "pending"];

interface BookingRef {
  venueId: string;
  sessionId: string | null;
  status: string;
}

/// The venue for the whole event (session-less booking) or for one session,
/// falling back to the whole-event booking when a session has none of its own.
function venueFor(bookings: BookingRef[], sessionId: string | null): string | null {
  const usable = bookings.filter((b) => VENUE_CHOSEN_STATUSES.includes(b.status));
  const pick = (id: string | null) =>
    usable.find((b) => b.sessionId === id && b.status === "approved") ??
    usable.find((b) => b.sessionId === id);
  return (sessionId ? pick(sessionId) : undefined)?.venueId ?? pick(null)?.venueId ?? null;
}

/// Availability of every equipment line the event has requested. The event
/// itself is left out of "reserved elsewhere", so it never blocks itself.
export async function loadEventAvailability(eventId: string): Promise<EventAvailability | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      venueBookings: { select: { venueId: true, sessionId: true, status: true } },
      equipmentRequests: {
        where: { status: { not: "cancelled" } },
        orderBy: { requestedAt: "asc" },
        select: {
          id: true,
          quantityRequested: true,
          sessionId: true,
          session: { select: { label: true, startsAt: true, endsAt: true } },
          equipment: {
            select: {
              id: true,
              name: true,
              totalQuantity: true,
              quantityInMaintenance: true,
              isActive: true,
              locationVenueId: true,
            },
          },
        },
      },
    },
  });
  if (!event) return null;

  const requested: RequestedLine[] = event.equipmentRequests.map((r) => ({
    requestId: r.id,
    quantityRequested: r.quantityRequested,
    equipment: r.equipment,
    sessionId: r.sessionId,
    sessionLabel: r.session?.label ?? null,
    startsAt: r.session?.startsAt ?? event.startsAt,
    endsAt: r.session?.endsAt ?? event.endsAt,
    venueId: venueFor(event.venueBookings, r.sessionId),
  }));

  const equipmentIds = [...new Set(requested.map((l) => l.equipment.id))];
  const otherRows = equipmentIds.length
    ? await prisma.equipmentRequest.findMany({
        where: {
          equipmentId: { in: equipmentIds },
          eventId: { not: event.id },
          status: { in: COMMITTING_REQUEST_STATUSES },
        },
        select: {
          equipmentId: true,
          status: true,
          quantityReserved: true,
          sessionId: true,
          session: { select: { startsAt: true, endsAt: true } },
          event: {
            select: {
              title: true,
              status: true,
              startsAt: true,
              endsAt: true,
              venueBookings: { select: { venueId: true, sessionId: true, status: true } },
            },
          },
        },
      })
    : [];

  const others: OtherRequest[] = otherRows.map((o) => ({
    equipmentId: o.equipmentId,
    eventTitle: o.event.title,
    requestStatus: o.status,
    quantityReserved: o.quantityReserved,
    eventStatus: o.event.status,
    startsAt: o.session?.startsAt ?? o.event.startsAt,
    endsAt: o.session?.endsAt ?? o.event.endsAt,
    venueId: venueFor(o.event.venueBookings, o.sessionId),
  }));

  return assembleLines(requested, others);
}
