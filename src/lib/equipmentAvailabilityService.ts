// SPM-48 — loads what the availability rules need and runs them for one event.
// The rules are in equipmentAvailability.ts, the per-line assembly in
// equipmentAvailabilityLines.ts; this file only reads the database.

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { COMMITTING_REQUEST_STATUSES } from "@/lib/equipmentAvailability";
import {
  assembleLines,
  type AvailabilityLine,
  type EventAvailability,
  type OtherRequest,
  type RequestedLine,
} from "@/lib/equipmentAvailabilityLines";

/// Either the shared client or one $transaction hands the callback - both
/// expose the same query methods this file uses.
type Db = PrismaClient | Prisma.TransactionClient;

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

/// "Held by" names the session too when a hold belongs to one, so a session
/// held by its own event's other session reads sensibly ("Two-Day Summit ·
/// Day 1"), not as the event blocking itself.
function heldByLabel(eventTitle: string | null, sessionLabel: string | null): string | null {
  if (!sessionLabel) return eventTitle;
  return `${eventTitle ?? "Untitled event"} · ${sessionLabel}`;
}

/// Availability of every equipment line the event has requested. Each line is
/// checked against every other request that holds the same item - other
/// events', and this event's own other sessions', which compete for the same
/// units - but never against itself.
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
          quantityReserved: true,
          status: true,
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
    requestStatus: r.status,
    quantityReserved: r.quantityReserved,
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
          status: { in: COMMITTING_REQUEST_STATUSES },
        },
        select: {
          id: true,
          equipmentId: true,
          status: true,
          quantityReserved: true,
          sessionId: true,
          session: { select: { label: true, startsAt: true, endsAt: true } },
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
    requestId: o.id,
    equipmentId: o.equipmentId,
    eventTitle: heldByLabel(o.event.title, o.session?.label ?? null),
    requestStatus: o.status,
    quantityReserved: o.quantityReserved,
    eventStatus: o.event.status,
    startsAt: o.session?.startsAt ?? o.event.startsAt,
    endsAt: o.session?.endsAt ?? o.event.endsAt,
    venueId: venueFor(o.event.venueBookings, o.sessionId),
  }));

  return assembleLines(requested, others);
}

/// SPM-49: one requested line's fresh availability, read with `db` - normally
/// a `$transaction` callback, so the read happens under the row lock the
/// reserve route takes on the equipment item first. Reusing loadEventAvailability
/// here would also load every OTHER line of the event, which the caller does
/// not need and would rather not pay for inside a lock.
export async function loadSingleLineAvailability(db: Db, requestId: string): Promise<AvailabilityLine | null> {
  const request = await db.equipmentRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      quantityRequested: true,
      quantityReserved: true,
      status: true,
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
      event: {
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          venueBookings: { select: { venueId: true, sessionId: true, status: true } },
        },
      },
    },
  });
  if (!request) return null;

  const line: RequestedLine = {
    requestId: request.id,
    quantityRequested: request.quantityRequested,
    requestStatus: request.status,
    quantityReserved: request.quantityReserved,
    equipment: request.equipment,
    sessionId: request.sessionId,
    sessionLabel: request.session?.label ?? null,
    startsAt: request.session?.startsAt ?? request.event.startsAt,
    endsAt: request.session?.endsAt ?? request.event.endsAt,
    venueId: venueFor(request.event.venueBookings, request.sessionId),
  };

  // Every other hold on this item, including this event's own other sessions -
  // the same rule as loadEventAvailability - but never this request itself, so
  // re-reserving a line does not count its current reservation against it.
  const otherRows = await db.equipmentRequest.findMany({
    where: {
      equipmentId: request.equipment.id,
      id: { not: request.id },
      status: { in: COMMITTING_REQUEST_STATUSES },
    },
    select: {
      id: true,
      equipmentId: true,
      status: true,
      quantityReserved: true,
      sessionId: true,
      session: { select: { label: true, startsAt: true, endsAt: true } },
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
  });
  const others: OtherRequest[] = otherRows.map((o) => ({
    requestId: o.id,
    equipmentId: o.equipmentId,
    eventTitle: heldByLabel(o.event.title, o.session?.label ?? null),
    requestStatus: o.status,
    quantityReserved: o.quantityReserved,
    eventStatus: o.event.status,
    startsAt: o.session?.startsAt ?? o.event.startsAt,
    endsAt: o.session?.endsAt ?? o.event.endsAt,
    venueId: venueFor(o.event.venueBookings, o.sessionId),
  }));

  return assembleLines([line], others).lines[0];
}
