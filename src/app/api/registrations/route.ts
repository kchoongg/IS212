import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { can, canViewEvent } from "@/lib/permissions";
import { createRegistrationSchema } from "@/lib/validation";
import { REGISTRATION_REFUSALS, registrationState } from "@/lib/registrationEligibility";
import { seatsHeld } from "@/lib/waitingList";
import { placeCounts, positionOnWaitingList, sweepWaitingList } from "@/lib/waitingListService";
import { ZodError } from "zod";

/// SPM-51 AC6: the signed-in attendee's own registrations, newest first, for
/// My Registrations (S-27). Withdrawn ones are included, with their status.
/// Closes the gap Integration.md §5 records ("cannot serve view status").
export async function GET(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    if (!can(actor.role, "registration:create")) {
      return forbidden("Registrations belong to an Attendee account.");
    }

    // SPM-66 (AC7, AC10): offers whose time is up end before they are listed.
    await sweepWaitingList();
    const registrations = await prisma.registration.findMany({
      where: { attendeeId: actor.id },
      orderBy: { registeredAt: "desc" },
      select: {
        id: true,
        eventId: true,
        status: true,
        registeredAt: true,
        // SPM-66: a place offered to them, until when.
        offerExpiresAt: true,
        event: {
          select: {
            sequenceNumber: true,
            title: true,
            status: true,
            startsAt: true,
            endsAt: true,
            // SPM-52: for the Withdraw question's warning (withdrawWarning()).
            registrationEnabled: true,
            registrationClosesAt: true,
          },
        },
      },
    });
    // SPM-66 (AC3): where each waiting one is in its event's queue.
    const withPositions = await Promise.all(
      registrations.map(async ({ eventId, ...r }) => ({
        ...r,
        waitingListPosition: r.status === "waitlisted" ? await positionOnWaitingList(prisma, eventId, r.id) : null,
      }))
    );
    return NextResponse.json(withPositions);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    // ADDED: registering is the Attendee's action (briefing §5 Step 11). A
    // coordinator or venue staff member signing themselves up as an attendee
    // would put a planning account into the attendee list.
    if (!can(actor.role, "registration:create")) {
      return forbidden("Only an Attendee can register for an event");
    }

    const body = await req.json();
    const data = createRegistrationSchema.parse(body);

    const event = await prisma.event.findUnique({ where: { id: data.eventId } });
    if (!event) {
      return hidden();
    }
    // ADDED: an event the attendee cannot see cannot be registered for
    // either - registering would otherwise confirm that a hidden event
    // exists. The business rules below (confirmed, in window, seats left)
    // still apply on top of this.
    if (!canViewEvent(actor, event)) {
      return hidden();
    }
    // CHANGED (SPM-51): eligibility is registrationState()
    // (src/lib/registrationEligibility.ts) - Confirmed, enabled, and inside a
    // registration period, which must now exist (AC3). Seats are counted
    // below, inside the transaction.
    const now = new Date();
    const state = registrationState(event, 0, now);
    if (state.kind !== "open") {
      return NextResponse.json({ error: REGISTRATION_REFUSALS[state.kind] }, { status: 400 });
    }

    // The @@unique([eventId, attendeeId]) constraint means a withdrawn attendee
    // cannot simply INSERT again. Reactivate their existing row instead, so
    // withdrawing and re-registering both work (user stories 19 and 20).
    const existing = await prisma.registration.findUnique({
      where: { eventId_attendeeId: { eventId: data.eventId, attendeeId: actor.id } },
    });
    if (existing && existing.status !== "withdrawn") {
      return NextResponse.json({ error: "Already registered for this event" }, { status: 400 });
    }

    // ADDED: capacity check. Counted inside the transaction below so two
    // attendees claiming the last seat at the same time cannot both succeed.
    // CHANGED (SPM-111): counting inside a transaction is not enough on its
    // own - both could count "1 free" before either saves. The row lock on the
    // event makes the second wait for the first and then count its place, as
    // the venue booking and equipment reserve routes do.
    const registration = await prisma.$transaction(async (tx) => {
      // CHANGED (SPM-66, AC8): a place under offer is held, and while anyone
      // is waiting a newcomer joins the list behind them rather than
      // registering past them (seatsHeld()).
      if (event.registrationCapacity != null) {
        await tx.$queryRaw`SELECT id FROM events WHERE id = ${data.eventId} FOR UPDATE`;
        const counts = await placeCounts(tx, data.eventId, now);
        if (registrationState(event, seatsHeld(event.registrationCapacity, counts), now).kind === "full") {
          throw new Error("EVENT_FULL");
        }
      }

      if (existing) {
        return tx.registration.update({
          where: { id: existing.id },
          data: {
            status: "registered",
            registeredAt: new Date(),
            withdrawnAt: null,
            // CHANGED: dietaryNeeds -> dietaryRequirements,
            //          accessibilityNeeds -> accessibilityRequirements.
            dietaryRequirements: data.dietaryRequirements,
            accessibilityRequirements: data.accessibilityRequirements,
          },
        });
      }

      return tx.registration.create({
        data: {
          eventId: data.eventId,
          attendeeId: actor.id,
          dietaryRequirements: data.dietaryRequirements,
          accessibilityRequirements: data.accessibilityRequirements,
          status: "registered",
        },
      });
    });

    return NextResponse.json(registration, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    if (err instanceof Error && err.message === "EVENT_FULL") {
      return NextResponse.json({ error: REGISTRATION_REFUSALS.full }, { status: 400 });
    }
    // Unique constraint = already registered for this event. Kept as a backstop
    // for the race where two requests pass the check above simultaneously.
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "Already registered for this event" }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
