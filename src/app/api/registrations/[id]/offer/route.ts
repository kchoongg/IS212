import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { can } from "@/lib/permissions";
import { respondToOfferSchema } from "@/lib/validation";
import { WAITING_LIST_MESSAGES, hasStarted, offerStands } from "@/lib/waitingList";
import { offerFreePlaces } from "@/lib/waitingListService";

// Join and Respond to Waiting List (SPM-66): the attendee answers the place
// offered to them. Accepting within the window registers them and takes them
// off the waiting list (AC6). Declining takes them off the list and the place
// goes to the next attendee (AC7).

class Refused extends Error {}

/// 404 for a registration that doesn't exist or isn't the caller's, as
/// withdrawing does - a 403 would confirm someone else's is real.
function notFound() {
  return NextResponse.json({ error: "Registration not found" }, { status: 404 });
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor(req);
    if (!actor) return unauthenticated();
    if (!can(actor.role, "registration:create")) {
      return forbidden("Only an Attendee can answer an offer of a place");
    }

    const { id } = await context.params;
    const registration = await prisma.registration.findUnique({ where: { id } });
    if (!registration || registration.attendeeId !== actor.id) return notFound();

    const { response } = respondToOfferSchema.parse(await req.json());
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${registration.eventId} FOR UPDATE`;
      // Read again under the lock: the sweep or the coordinator may have
      // ended the offer since.
      const current = await tx.registration.findUnique({
        where: { id },
        include: { event: { select: { startsAt: true } } },
      });
      if (!current || current.status !== "waitlisted" || !current.offerExpiresAt) {
        throw new Refused(WAITING_LIST_MESSAGES.noOffer);
      }
      if (!offerStands(current.offerExpiresAt, now) || hasStarted(current.event.startsAt, now)) {
        throw new Refused(WAITING_LIST_MESSAGES.offerEnded);
      }

      if (response === "accept") {
        return tx.registration.update({
          where: { id },
          data: { status: "registered", registeredAt: now, offerExpiresAt: null, offerEndedReason: null },
        });
      }
      const declined = await tx.registration.update({
        where: { id },
        data: { status: "withdrawn", withdrawnAt: now, offerExpiresAt: null, offerEndedReason: "declined" },
      });
      await offerFreePlaces(tx, registration.eventId, now);
      return declined;
    });

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Refused) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
