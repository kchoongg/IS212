import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { parseEventReference } from "@/lib/format";
import { can, canViewEvent } from "@/lib/permissions";
import { joinWaitingListSchema } from "@/lib/validation";
import { registrationState } from "@/lib/registrationEligibility";
import { joinRefusal, seatsHeld } from "@/lib/waitingList";
import { placeCounts } from "@/lib/waitingListService";

// Join and Respond to Waiting List (SPM-66, AC1, AC2): an attendee joins a
// full event's waiting list instead of registering. Same order as registering
// (POST /api/registrations): 401, 403 for a role that can't register, 404 for
// an event the attendee may not see, then the rules.

class Refused extends Error {}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor(req);
    if (!actor) return unauthenticated();
    if (!can(actor.role, "registration:create")) {
      return forbidden("Only an Attendee can join a waiting list");
    }

    const { id } = await context.params;
    const sequenceNumber = parseEventReference(id);
    const event = sequenceNumber === null ? null : await prisma.event.findUnique({ where: { sequenceNumber } });
    if (!event || !canViewEvent(actor, event)) return hidden();

    const data = joinWaitingListSchema.parse(await req.json());
    const now = new Date();

    // Counted under the event's row lock, as registering is (SPM-111), so a
    // place freed at the same moment is either offered or taken, never both.
    const joined = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${event.id} FOR UPDATE`;
      const counts = await placeCounts(tx, event.id, now);
      const existing = await tx.registration.findUnique({
        where: { eventId_attendeeId: { eventId: event.id, attendeeId: actor.id } },
      });
      const state = registrationState(event, seatsHeld(event.registrationCapacity, counts), now);
      const refusal = joinRefusal(state, existing && existing.status !== "withdrawn" ? existing.status : null);
      if (refusal) throw new Refused(refusal);

      const fields = {
        status: "waitlisted",
        waitlistedAt: now,
        registeredAt: now,
        withdrawnAt: null,
        offeredAt: null,
        offerExpiresAt: null,
        offerEndedReason: null,
        dietaryRequirements: data.dietaryRequirements?.trim() || null,
        accessibilityRequirements: data.accessibilityRequirements?.trim() || null,
      };
      // @@unique([eventId, attendeeId]): someone who left comes back on the same row.
      return existing
        ? tx.registration.update({ where: { id: existing.id }, data: fields })
        : tx.registration.create({ data: { ...fields, eventId: event.id, attendeeId: actor.id } });
    });

    return NextResponse.json(joined, { status: 201 });
  } catch (err) {
    if (err instanceof Refused) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
