import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { parseEventReference } from "@/lib/format";
import { canViewEvent, isAssignedCoordinator } from "@/lib/permissions";
import { notifyUser } from "@/lib/notifications";
import { offerPlaceSchema } from "@/lib/validation";
import {
  WAITING_LIST_MESSAGES,
  hasStarted,
  offerEndedNotice,
  offerExpiry,
  offerMadeNotice,
} from "@/lib/waitingList";

// Join and Respond to Waiting List (SPM-66, AC9): the assigned coordinator
// overrides the first-in, first-out order (#26) by giving a place that is
// under offer to a chosen waitlisted attendee instead. Never beyond the
// capacity: with no place under offer there is nothing to give (decided
// 2026-10-23). The attendee who held the offer keeps their position.

class Refused extends Error {}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor(req);
    if (!actor) return unauthenticated();

    const { id } = await context.params;
    const sequenceNumber = parseEventReference(id);
    const event = sequenceNumber === null ? null : await prisma.event.findUnique({ where: { sequenceNumber } });
    if (!event || !canViewEvent(actor, event)) return hidden();
    if (!isAssignedCoordinator(actor, event)) return forbidden(WAITING_LIST_MESSAGES.coordinatorOnly);

    const { registrationId } = offerPlaceSchema.parse(await req.json());
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${event.id} FOR UPDATE`;
      if (event.status !== "confirmed" || hasStarted(event.startsAt, now)) throw new Refused(WAITING_LIST_MESSAGES.started);

      const chosen = await tx.registration.findUnique({ where: { id: registrationId } });
      if (!chosen || chosen.eventId !== event.id || chosen.status !== "waitlisted") {
        throw new Refused(WAITING_LIST_MESSAGES.notWaiting);
      }
      if (chosen.offerExpiresAt && chosen.offerExpiresAt > now) throw new Refused(WAITING_LIST_MESSAGES.alreadyOffered);

      // The place moved is the offer made last - the attendee furthest down
      // the list among those holding one.
      const holder = await tx.registration.findFirst({
        where: { eventId: event.id, status: "waitlisted", offerExpiresAt: { gt: now } },
        orderBy: { offeredAt: "desc" },
      });
      if (!holder) throw new Refused(WAITING_LIST_MESSAGES.noPlaceOnOffer);

      await tx.registration.update({
        where: { id: holder.id },
        data: { offerExpiresAt: null, offerEndedReason: "moved" },
      });
      const expiresAt = offerExpiry(now, event.startsAt);
      const offered = await tx.registration.update({
        where: { id: chosen.id },
        data: { offeredAt: now, offerExpiresAt: expiresAt, offerEndedReason: null },
      });
      await notifyUser(tx, chosen.attendeeId, { ...offerMadeNotice(event.title, expiresAt), eventId: event.id });
      await notifyUser(tx, holder.attendeeId, { ...offerEndedNotice(event.title, "moved"), eventId: event.id });
      return { offered, movedFrom: holder.id };
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Refused) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
