import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import {
  can,
  canBeginPlanning,
  canRequestVenueBooking,
  canViewRegistrationList,
} from "@/lib/permissions";
import { eventReference, parseEventReference } from "@/lib/format";
import { createVenueBookingSchema } from "@/lib/validation";
import { isBeforeApproval, isTerminalEventStatus } from "@/lib/statuses";
import { CLOSED_EVENT_MESSAGE, NOT_APPROVED_MESSAGE, checkVenueBookingRequest } from "@/lib/venueBookingRequest";
import { PLANNING_REASONS, beginPlanningIfApproved } from "@/lib/beginPlanning";
import { CLOSE_REASONS } from "@/lib/safetyResolution";
import { closeSafetyCheckAfterChange } from "@/lib/safetyCheckClose";
import { canChangeBookingsOf } from "@/lib/venueBookingChange";
import { defaultHoldExpiry } from "@/lib/holdExpiry";
import { expireDueHolds } from "@/lib/holdExpiryService";
import { canViewEventWithHistory } from "@/lib/eventVisibility";

// SPM-42, Request Venue Booking. GET is what the Venue tab needs to offer a
// request: the event's sessions, its existing requests, and whether this user
// may request at all. POST creates a pending request; every rule lives in
// checkVenueBookingRequest() (src/lib/venueBookingRequest.ts). Withdrawing or
// releasing one is PATCH ./[bookingId] (SPM-67).

const ONLY_ASSIGNED = "Only the assigned Coordinator can request a venue booking.";

const BOOKING_FIELDS = {
  id: true,
  status: true,
  startsAt: true,
  endsAt: true,
  layoutName: true,
  // SPM-90: what the space is for, and its own attendance.
  purpose: true,
  expectedAttendance: true,
  // SPM-82 (AC1, AC8): when a pending request's hold expires, or when it did.
  holdExpiresAt: true,
  requirementsNote: true,
  requestedAt: true,
  // SPM-43: Venue Staff's decision, for the coordinator to act on (AC6).
  decisionReason: true,
  suggestedAlternative: true,
  suggestedVenue: { select: { id: true, code: true, name: true, isActive: true } },
  // SPM-67 (AC5): the Coordinator's reason for withdrawing or releasing it.
  cancellationReason: true,
  session: { select: { id: true, label: true } },
  venue: { select: { id: true, code: true, name: true, setupMinutes: true, teardownMinutes: true } },
} as const;

async function loadEvent(reference: string) {
  const sequenceNumber = parseEventReference(reference);
  if (sequenceNumber === null) return null;
  return prisma.event.findUnique({
    where: { sequenceNumber },
    include: {
      facilityRequirements: { include: { facility: true } },
      sessions: { orderBy: { startsAt: "asc" } },
    },
  });
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }
  // Same audience as the Venue tab (SPM-41): staff who may see venues.
  if (!can(actor.role, "venue:view")) {
    return forbidden("Venue bookings are for ConnectSphere staff");
  }
  const event = await loadEvent(id);
  if (!event || !(await canViewEventWithHistory(actor, event))) {
    return hidden();
  }

  // SPM-82: overdue holds are marked expired first, so the list shows them as
  // they are (AC4, AC8).
  await expireDueHolds();
  const bookings = await prisma.venueBooking.findMany({
    where: { eventId: event.id },
    select: BOOKING_FIELDS,
    orderBy: { requestedAt: "desc" },
  });

  // Why the Request booking button is missing, if it is (TC12, TC13).
  const cannotRequest = !canRequestVenueBooking(actor, event)
    ? ONLY_ASSIGNED
    : isTerminalEventStatus(event.status)
      ? CLOSED_EVENT_MESSAGE
      : isBeforeApproval(event.status)
        ? NOT_APPROVED_MESSAGE
        : null;

  return NextResponse.json({
    // SPM-90 (AC2): the attendance and layout a request starts on.
    event: { title: event.title, preferredLayout: event.preferredLayout, expectedAttendance: event.expectedAttendance },
    schedule: { startsAt: event.startsAt, endsAt: event.endsAt },
    sessions: event.sessions.map((s) => ({
      id: s.id,
      label: s.label,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      expectedAttendance: s.expectedAttendance,
      preferredLayout: s.preferredLayout,
    })),
    cannotRequest,
    // SPM-54: the form asks before a request that would begin planning.
    willBeginPlanning: cannotRequest === null && canBeginPlanning(actor, event),
    // SPM-67: whether this user may withdraw a pending request or release an
    // approved booking (PATCH .../venue-bookings/[bookingId]). Unlike a new
    // request, an event awaiting approval may still let one go.
    canChangeBookings: canRequestVenueBooking(actor, event) && canChangeBookingsOf(event.status),
    // SPM-65: whether the Venue tab's tab bar offers Attendees.
    canViewRegistrationList: canViewRegistrationList(actor, event),
    bookings,
  });
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    const event = await loadEvent(id);
    if (!event || !(await canViewEventWithHistory(actor, event))) {
      return hidden();
    }
    if (!canRequestVenueBooking(actor, event)) {
      return forbidden(ONLY_ASSIGNED);
    }

    const data = createVenueBookingSchema.parse(await req.json());

    // AC4: a multi-session event books per session, never as a whole.
    let session: (typeof event.sessions)[number] | null = null;
    if (event.sessions.length > 0) {
      session = event.sessions.find((s) => s.id === data.sessionId) ?? null;
      if (!session) {
        return NextResponse.json({ error: "Choose a session." }, { status: 400 });
      }
    } else if (data.sessionId) {
      return NextResponse.json({ error: "Session not found for this event" }, { status: 400 });
    }
    const schedule = session ?? (event.startsAt && event.endsAt ? { startsAt: event.startsAt, endsAt: event.endsAt } : null);
    if (!schedule) {
      return NextResponse.json({ error: "Set the event date and time before requesting a venue." }, { status: 400 });
    }

    // SPM-90: the space's own attendance and layout where the Coordinator gave
    // them. Otherwise (AC2, and D11) the session's own, else the event's. The
    // facilities are always the event's.
    const own = session ?? event;
    const expectedAttendance = data.expectedAttendance ?? own.expectedAttendance;
    const preferredLayout = data.layoutName !== undefined ? data.layoutName : own.preferredLayout;

    // The check and the insert are one step. Read before the transaction, two
    // coordinators asking for the same slot at the same moment could each
    // pass the check before the other's row was written (raised in review on
    // PR #37). Locking the venue row first - as the approval route does
    // (PATCH /api/venue-bookings/[id]) - makes the second request wait, and
    // then read the first one's booking. Everything below reads after the lock.
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM venues WHERE id = ${data.venueId} FOR UPDATE`;
      // SPM-82 (AC6): a hold that has run out stops counting before the
      // bookings are read, so the time it took up is free for this request.
      await expireDueHolds(tx);

      const venue = await tx.venue.findUnique({
        where: { id: data.venueId },
        include: {
          layouts: true,
          facilities: true,
          // SPM-44 (AC9): the refusal names the booking in the way, so the
          // event behind each one is loaded with it. Only active bookings are
          // read - a rejected or cancelled one holds nothing (AC7).
          bookings: {
            where: { status: { in: ["pending", "approved"] } },
            include: { event: { select: { sequenceNumber: true, title: true } } },
          },
          unavailability: true,
        },
      });
      // Retired venues are out of the catalogue (see GET /venue-suitability).
      if (!venue || !venue.isActive) {
        return { error: "Venue not found" } as const;
      }

      const check = checkVenueBookingRequest({
        eventId: event.id,
        sessionId: session?.id ?? null,
        eventStatus: event.status,
        holder: session
          ? { kind: "session", name: session.label ?? "This session" }
          : { kind: "event", name: event.title ?? "This event" },
        schedule,
        needs: {
          expectedAttendance,
          preferredLayout,
          requirements: event.facilityRequirements.map((r) => ({
            facilityId: r.facilityId,
            name: r.facility.name,
            category: r.facility.category,
            isMandatory: r.isMandatory,
          })),
        },
        venue: {
          ...venue,
          facilityIds: venue.facilities.map((f) => f.facilityId),
          bookings: venue.bookings.map((b) => ({
            ...b,
            eventReference: eventReference(b.event.sequenceNumber),
            eventTitle: b.event.title,
          })),
        },
        day: data.day,
        startTime: data.startTime,
        endTime: data.endTime,
      });
      if (!check.ok) {
        // SPM-93 AC3: a refused time names the field it belongs to.
        return check.field ? ({ error: check.error, field: check.field } as const) : ({ error: check.error } as const);
      }

      const created = await tx.venueBooking.create({
        data: {
          eventId: event.id,
          sessionId: session?.id,
          venueId: venue.id,
          purpose: data.purpose,
          expectedAttendance,
          layoutName: preferredLayout,
          startsAt: check.window.startsAt,
          endsAt: check.window.endsAt,
          status: "pending",
          // SPM-82 (AC2): a tentative hold until Venue Staff approve it - 7
          // days, or until the event starts if that is sooner.
          holdExpiresAt: defaultHoldExpiry(new Date(), event.startsAt),
          requestedBy: actor.id,
          requirementsNote: data.requirementsNote,
        },
        select: BOOKING_FIELDS,
      });
      // SPM-54: the first booking request for an Approved event begins
      // planning, in the same transaction as the request itself.
      const planningStarted = await beginPlanningIfApproved(tx, event, actor.id, PLANNING_REASONS.venueBooking);
      // SPM-88: a new booking closes the safety check the event rests on.
      const safetyCheckClosed = await closeSafetyCheckAfterChange(tx, event, actor.id, CLOSE_REASONS.bookingRequested, false);
      return { created, planningStarted, safetyCheckClosed } as const;
    });
    if ("error" in result) {
      return NextResponse.json(result, { status: 400 });
    }
    const { created, planningStarted, safetyCheckClosed } = result;
    return NextResponse.json({ ...created, planningStarted, safetyCheckClosed }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
