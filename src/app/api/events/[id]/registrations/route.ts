import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { parseEventReference } from "@/lib/format";
import { canAddAttendees, canViewRegistrationList, isAssignedCoordinator } from "@/lib/permissions";
import { registrationCounts } from "@/lib/registrationEligibility";
import { hasStarted, waitingOrder } from "@/lib/waitingList";
import { placeCounts, sweepWaitingList } from "@/lib/waitingListService";
import { canViewEventWithHistory } from "@/lib/eventVisibility";
import { addAttendeeSchema } from "@/lib/validation";
import {
  ADD_ATTENDEE_MESSAGES,
  addAttendeeRefusal,
  addedMessage,
  alreadyHoldsPlace,
  venueCapacity,
  venueFullError,
} from "@/lib/manualRegistration";

// View Registration List (SPM-65): who has registered for an event, for the
// Organiser responsible for it and the Coordinator assigned to it (AC1, AC8,
// AC9 - canViewRegistrationList()). Same order as the registration settings
// route (../registration/route.ts): 401, then 404 for an event the user may
// not see, then 403.
//
// Read fresh on every request (route handlers are not cached), so the
// Attendees tab, which asks again every 15 seconds, shows registrations,
// withdrawals and waiting-list changes as they happen (AC6).
//
// POST is Manually Add Attendee (SPM-57): the assigned coordinator adds an
// Attendee account by its email address. The rules are
// src/lib/manualRegistration.ts.

/// The event's bookings, with what each room seats in each layout - for the
/// venue capacity a manual addition is measured against (SPM-57 AC3).
const BOOKING_FIELDS = {
  id: true,
  status: true,
  layoutName: true,
  venue: { select: { name: true, code: true, layouts: { select: { layoutName: true, capacity: true } } } },
} as const;

/// Thrown inside the transaction once the room is full (AC3).
class VenueFull extends Error {}

/// A refusal that belongs to the 'Attendee email' field, in the shape
/// readServerError() maps onto the form.
function emailError(message: string) {
  return NextResponse.json({ error: message, details: { fieldErrors: { email: [message] } } }, { status: 400 });
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor(req);
    if (!actor) return unauthenticated();

    const { id } = await context.params;
    const sequenceNumber = parseEventReference(id);
    const event = sequenceNumber === null ? null : await prisma.event.findUnique({ where: { sequenceNumber } });
    // An event the user may not see is 404, never 403 - a 403 would confirm it exists.
    if (!event || !(await canViewEventWithHistory(actor, event))) return hidden();
    if (!canViewRegistrationList(actor, event)) {
      return forbidden("Only the event's organiser and its assigned coordinator can view its registrations");
    }

    // SPM-66 (AC7, AC10): offers whose time is up end before the list is read.
    await sweepWaitingList();
    const [registrations, byStatus, bookings] = await Promise.all([
      prisma.registration.findMany({
        where: { eventId: event.id },
        orderBy: { registeredAt: "asc" },
        select: {
          id: true,
          status: true,
          registeredAt: true,
          withdrawnAt: true,
          dietaryRequirements: true,
          accessibilityRequirements: true,
          // SPM-66: the waiting list's order and any place under offer.
          waitlistedAt: true,
          offeredAt: true,
          offerExpiresAt: true,
          attendee: { select: { fullName: true, email: true, phone: true } },
          addedBy: { select: { fullName: true } },
        },
      }),
      prisma.registration.groupBy({ by: ["status"], where: { eventId: event.id }, _count: { _all: true } }),
      prisma.venueBooking.findMany({ where: { eventId: event.id }, select: BOOKING_FIELDS }),
    ]);
    const mayAdd = canAddAttendees(actor, event);
    const venue = venueCapacity(bookings, event.registrationVenueBookingId ?? null);

    // SPM-66 (AC3, AC9): each waiting attendee's position, for the coordinator
    // choosing who to offer a place to.
    const positions = new Map(
      waitingOrder(registrations.filter((r) => r.status === "waitlisted")).map((r, i) => [r.id, i + 1])
    );

    return NextResponse.json({
      event: { sequenceNumber: event.sequenceNumber, title: event.title, status: event.status },
      // SPM-66 (AC9): whether this viewer may give a place out of turn - the
      // assigned coordinator, while the event is Confirmed and not started.
      canOfferPlaces:
        isAssignedCoordinator(actor, event) && event.status === "confirmed" && !hasStarted(event.startsAt, new Date()),
      // AC7: the page says registration is not enabled rather than showing an
      // empty list. Registrations made before it was turned off are still sent.
      registrationEnabled: event.registrationEnabled,
      // AC5: active registrations against this, and the waiting list.
      registrationCapacity: event.registrationCapacity,
      counts: registrationCounts(byStatus.map((s) => ({ status: s.status, count: s._count._all }))),
      // SPM-57 AC3: the room a manual addition is measured against, or null
      // when it isn't known.
      venueCapacity: venue,
      // SPM-57: whether this user may add attendees (the assigned coordinator),
      // and if they may but not now, why. A null reason: they may.
      canAddAttendees: mayAdd,
      addAttendeesRefusal: mayAdd ? addAttendeeRefusal(event, venue, new Date()) : null,
      registrations: registrations.map((r) => ({
        id: r.id,
        status: r.status,
        registeredAt: r.registeredAt,
        withdrawnAt: r.withdrawnAt,
        // SPM-57 AC1: recorded by the attendee, or by the coordinator.
        dietaryRequirements: r.dietaryRequirements,
        accessibilityRequirements: r.accessibilityRequirements,
        waitingListPosition: positions.get(r.id) ?? null,
        offeredAt: r.offeredAt,
        offerExpiresAt: r.offerExpiresAt,
        attendee: { name: r.attendee.fullName, email: r.attendee.email, phone: r.attendee.phone },
        // AC4: added on the Organiser's behalf (Manually Add Attendee); null
        // when the attendee registered themselves.
        addedBy: r.addedBy ? { name: r.addedBy.fullName } : null,
      })),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/// SPM-57: add an Attendee account to the registration list. 401, then 404 for
/// an event the user may not see, then 403 for anyone but the assigned
/// coordinator, then the event's status, registration, start and venue
/// capacity (addAttendeeRefusal), then the form, then the account, then the
/// places left in the room (AC3).
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor(req);
    if (!actor) return unauthenticated();

    const { id } = await context.params;
    const sequenceNumber = parseEventReference(id);
    const event = sequenceNumber === null ? null : await prisma.event.findUnique({ where: { sequenceNumber } });
    if (!event || !(await canViewEventWithHistory(actor, event))) return hidden();
    if (!canAddAttendees(actor, event)) {
      return forbidden("Only the coordinator assigned to this event can add attendees");
    }
    const bookings = await prisma.venueBooking.findMany({ where: { eventId: event.id }, select: BOOKING_FIELDS });
    const venue = venueCapacity(bookings, event.registrationVenueBookingId ?? null);
    const now = new Date();
    const refusal = addAttendeeRefusal(event, venue, now);
    if (refusal || !venue) {
      return NextResponse.json({ error: refusal ?? ADD_ATTENDEE_MESSAGES.capacityUnknown }, { status: 400 });
    }

    const data = addAttendeeSchema.parse(await req.json());

    // AC1: an existing, active Attendee account. Any other account - staff,
    // an organiser, a deactivated attendee - is refused the same way.
    const attendee = await prisma.user.findUnique({
      where: { email: data.email },
      select: { id: true, fullName: true, role: true, isActive: true },
    });
    if (!attendee || attendee.role !== "attendee" || !attendee.isActive) {
      return emailError(ADD_ATTENDEE_MESSAGES.noAccount);
    }

    const existing = await prisma.registration.findUnique({
      where: { eventId_attendeeId: { eventId: event.id, attendeeId: attendee.id } },
      select: { id: true, status: true },
    });
    const holding = existing && alreadyHoldsPlace(attendee.fullName, existing.status);
    if (holding) return emailError(holding);

    // AC3, counted under the event's row lock, as POST /api/registrations
    // does (SPM-111): a coordinator adding the last seat and an attendee
    // taking it at the same moment can't both succeed. A place under offer to
    // the waiting list is held (SPM-66 AC8), so it counts as taken.
    const registration = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${event.id} FOR UPDATE`;
      const full = venueFullError(venue, await placeCounts(tx, event.id, now));
      if (full) throw new VenueFull(full);

      // AC4: the row self-registration writes - a withdrawn attendee's own
      // row registered again - plus who added it (SPM-65 AC4). A requirement
      // left blank is cleared (null), so a re-added attendee doesn't keep
      // what they gave when they registered before.
      const fields = {
        status: "registered",
        registeredAt: now,
        withdrawnAt: null,
        dietaryRequirements: data.dietaryRequirements ?? null,
        accessibilityRequirements: data.accessibilityRequirements ?? null,
        addedById: actor.id,
      };
      if (existing) return tx.registration.update({ where: { id: existing.id }, data: fields });
      return tx.registration.create({ data: { eventId: event.id, attendeeId: attendee.id, ...fields } });
    });

    return NextResponse.json(
      { id: registration.id, status: registration.status, message: addedMessage(attendee.fullName) },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    if (err instanceof VenueFull) return NextResponse.json({ error: err.message }, { status: 400 });
    // The attendee registered themselves between the check above and the
    // insert: the unique (event, attendee) constraint stops a second row.
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return emailError("This attendee is already registered for this event.");
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
