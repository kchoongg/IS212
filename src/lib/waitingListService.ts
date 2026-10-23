// Join and Respond to Waiting List (SPM-66): the waiting list rules in
// waitingList.ts, applied to the database.
//
// offerFreePlaces() offers each free place to the next attendee waiting. It is
// called wherever a place can come free: an attendee withdraws or leaves the
// list holding an offer, an offer is declined or lapses, or the capacity is
// raised. It runs inside the caller's transaction and locks the event row
// first, as registering does (SPM-111), so two requests freeing places at once
// never offer the same place twice.
//
// Offers end with time, so - like SPM-82's venue holds - there is no
// scheduled job (decided 2026-10-23): sweepWaitingList() runs before
// registrations are read and on the unread-notifications count every page asks
// for. Each step is one UPDATE ... RETURNING, so two sweeps never end the same
// offer twice.

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/notifications";
import { SEAT_TAKING } from "@/lib/registrationEligibility";
import {
  freePlaces,
  hasStarted,
  offerEndedNotice,
  offerExpiry,
  offerMadeNotice,
  waitingOrder,
  waitingPosition,
  type PlaceCounts,
} from "@/lib/waitingList";

type Db = PrismaClient | Prisma.TransactionClient;

/// AC1, AC8: the event's places - taken, under offer, and still waiting.
export async function placeCounts(db: Db, eventId: string, now: Date): Promise<PlaceCounts> {
  const [taken, underOffer, waiting] = await Promise.all([
    db.registration.count({ where: { eventId, status: { in: SEAT_TAKING } } }),
    db.registration.count({ where: { eventId, status: "waitlisted", offerExpiresAt: { gt: now } } }),
    db.registration.count({ where: { eventId, status: "waitlisted", offerExpiresAt: null } }),
  ]);
  return { taken, underOffer, waiting };
}

/// AC5: offer every free place, first in first out, and tell each attendee.
/// Nothing for an event that isn't Confirmed, has started (AC10) or has no
/// capacity. Returns how many offers were made.
export async function offerFreePlaces(tx: Prisma.TransactionClient, eventId: string, now: Date = new Date()): Promise<number> {
  await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`;
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: { title: true, status: true, startsAt: true, registrationCapacity: true },
  });
  if (!event || event.status !== "confirmed" || hasStarted(event.startsAt, now)) return 0;

  const free = freePlaces(event.registrationCapacity, await placeCounts(tx, eventId, now));
  if (free === 0) return 0;

  const waiting = await tx.registration.findMany({
    where: { eventId, status: "waitlisted", offerExpiresAt: null },
    select: { id: true, attendeeId: true, waitlistedAt: true, registeredAt: true },
  });
  const expiresAt = offerExpiry(now, event.startsAt);
  const chosen = waitingOrder(waiting).slice(0, free);
  for (const r of chosen) {
    await tx.registration.update({
      where: { id: r.id },
      data: { offeredAt: now, offerExpiresAt: expiresAt, offerEndedReason: null },
    });
    await notifyUser(tx, r.attendeeId, { ...offerMadeNotice(event.title, expiresAt), eventId });
  }
  return chosen.length;
}

interface EndedOffer {
  eventId: string;
  attendeeId: string;
  eventTitle: string | null;
}

/// AC7, AC10: end the offers whose time is up. An event that has started ends
/// its offers and the attendee keeps their place in the queue; an offer that
/// simply lapsed takes the attendee off the list, and the place goes to the
/// next one.
export async function sweepWaitingList(
  db: PrismaClient = prisma,
  now: Date = new Date()
): Promise<{ started: number; expired: number }> {
  const started = (await db.$queryRaw<EndedOffer[]>`
    UPDATE registrations r SET offer_expires_at = NULL, offer_ended_reason = 'event_started'
    FROM events e
    WHERE r.event_id = e.id AND r.status = 'waitlisted' AND r.offer_expires_at IS NOT NULL
      AND e.starts_at <= ${now}
    RETURNING r.event_id AS "eventId", r.attendee_id AS "attendeeId", e.title AS "eventTitle"
  `) ?? [];

  const expired = (await db.$queryRaw<EndedOffer[]>`
    UPDATE registrations r
    SET status = 'withdrawn', withdrawn_at = ${now}, offer_expires_at = NULL, offer_ended_reason = 'expired'
    FROM events e
    WHERE r.event_id = e.id AND r.status = 'waitlisted' AND r.offer_expires_at <= ${now}
    RETURNING r.event_id AS "eventId", r.attendee_id AS "attendeeId", e.title AS "eventTitle"
  `) ?? [];

  const notices = [
    ...started.map((row) => ({ row, notice: offerEndedNotice(row.eventTitle, "event_started") })),
    ...expired.map((row) => ({ row, notice: offerEndedNotice(row.eventTitle, "expired") })),
  ];
  if (notices.length > 0) {
    await db.notification.createMany({
      data: notices.map(({ row, notice }) => ({ recipientId: row.attendeeId, eventId: row.eventId, ...notice })),
    });
  }

  // AC7: each lapsed offer's place goes to the next attendee waiting.
  for (const eventId of new Set(expired.map((row) => row.eventId))) {
    await db.$transaction((tx) => offerFreePlaces(tx, eventId, now));
  }
  return { started: started.length, expired: expired.length };
}

/// AC3: this registration's position on its event's waiting list, or null.
export async function positionOnWaitingList(db: Db, eventId: string, registrationId: string): Promise<number | null> {
  const waiting = await db.registration.findMany({
    where: { eventId, status: "waitlisted" },
    select: { id: true, waitlistedAt: true, registeredAt: true },
  });
  return waitingPosition(waiting, registrationId);
}
