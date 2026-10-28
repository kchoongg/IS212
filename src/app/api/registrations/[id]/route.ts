import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { can } from "@/lib/permissions";
import { withdrawRegistrationSchema } from "@/lib/validation";
import { WITHDRAW_REFUSALS, withdrawRefusal } from "@/lib/registrationEligibility";
import { leaveRefusal } from "@/lib/waitingList";
import { offerFreePlaces } from "@/lib/waitingListService";

// Withdraw from Event (SPM-52): the attendee withdraws their own registration
// - `{ status: "withdrawn" }`, the route Integration.md §5 proposed. The row is
// kept (status withdrawn, withdrawnAt set), so My Registrations still lists it
// and POST /api/registrations can reactivate it if they register again. The
// seat comes back on its own: seats are counted from SEAT_TAKING, which a
// withdrawn registration is not in.
//
// SPM-66: the same request takes an attendee off the waiting list (AC4) -
// those behind move up, since a position is counted, not stored. A seat given
// back, or an offer held by someone leaving, is then offered to the next
// attendee waiting (AC5).

/// 404 for a registration that doesn't exist or isn't the caller's - a 403
/// would confirm someone else's registration is real.
function notFound() {
  return NextResponse.json({ error: "Registration not found" }, { status: 404 });
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    if (!can(actor.role, "registration:create")) {
      return forbidden("Only an Attendee can withdraw a registration");
    }

    const { id } = await context.params;
    const registration = await prisma.registration.findUnique({
      where: { id },
      include: { event: { select: { status: true, endsAt: true } } },
    });
    if (!registration || registration.attendeeId !== actor.id) {
      return notFound();
    }

    withdrawRegistrationSchema.parse(await req.json());

    // AC1: only a registration holding a seat, for an event that isn't over
    // or cancelled. SPM-66 (AC4): or a place on the waiting list.
    const now = new Date();
    const leaving = registration.status === "waitlisted";
    const refusal = leaving
      ? leaveRefusal(registration.event, now)
      : withdrawRefusal(registration.status, registration.event, now);
    if (refusal) {
      return NextResponse.json({ error: refusal }, { status: 400 });
    }
    // Updated only while the status is unchanged, so a double click can't
    // withdraw twice.
    const withdrawn = await prisma.$transaction(async (tx) => {
      const changed = await tx.registration.updateMany({
        where: { id, status: registration.status },
        data: {
          status: "withdrawn",
          withdrawnAt: now,
          ...(leaving && registration.offerExpiresAt ? { offerExpiresAt: null, offerEndedReason: "left" } : {}),
        },
      });
      // SPM-66 (AC5): the seat, or the offer, goes to the next one waiting.
      if (changed.count > 0 && (!leaving || registration.offerExpiresAt)) {
        await offerFreePlaces(tx, registration.eventId, now);
      }
      return changed;
    });
    if (withdrawn.count === 0) {
      return NextResponse.json({ error: WITHDRAW_REFUSALS.not_active }, { status: 400 });
    }

    return NextResponse.json(await prisma.registration.findUnique({ where: { id } }));
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
