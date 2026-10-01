import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { can, canRequestVenueBooking, canViewEvent } from "@/lib/permissions";
import { parseEventReference } from "@/lib/format";
import { createVenueBookingSchema } from "@/lib/validation";
import { isTerminalEventStatus } from "@/lib/statuses";
import { CLOSED_EVENT_MESSAGE, checkVenueBookingRequest } from "@/lib/venueBookingRequest";

// SPM-42, Request Venue Booking. GET is what the Venue tab needs to offer a
// request: the event's sessions, its existing requests, and whether this user
// may request at all. POST creates a pending request; every rule lives in
// checkVenueBookingRequest() (src/lib/venueBookingRequest.ts).

const ONLY_ASSIGNED = "Only the assigned Coordinator can request a venue booking.";

const BOOKING_FIELDS = {
  id: true,
  status: true,
  startsAt: true,
  endsAt: true,
  layoutName: true,
  requirementsNote: true,
  requestedAt: true,
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
  if (!event || !canViewEvent(actor, event)) {
    return hidden();
  }

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
      : null;

  return NextResponse.json({
    event: { title: event.title, preferredLayout: event.preferredLayout },
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
    if (!event || !canViewEvent(actor, event)) {
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

    const venue = await prisma.venue.findUnique({
      where: { id: data.venueId },
      include: {
        layouts: true,
        facilities: true,
        bookings: { where: { status: { in: ["pending", "approved"] } } },
        unavailability: true,
      },
    });
    // Retired venues are out of the catalogue (see GET /venue-suitability).
    if (!venue || !venue.isActive) {
      return NextResponse.json({ error: "Venue not found" }, { status: 400 });
    }

    // D11: a session's own attendance and layout, the event's facilities.
    const preferredLayout = session ? session.preferredLayout : event.preferredLayout;
    const check = checkVenueBookingRequest({
      eventId: event.id,
      eventStatus: event.status,
      holder: session
        ? { kind: "session", name: session.label ?? "This session" }
        : { kind: "event", name: event.title ?? "This event" },
      schedule,
      needs: {
        expectedAttendance: session ? session.expectedAttendance : event.expectedAttendance,
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
      },
      day: data.day,
      slots: data.slots,
    });
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }

    const created = await prisma.venueBooking.create({
      data: {
        eventId: event.id,
        sessionId: session?.id,
        venueId: venue.id,
        layoutName: preferredLayout,
        startsAt: check.window.startsAt,
        endsAt: check.window.endsAt,
        status: "pending",
        requestedBy: actor.id,
        requirementsNote: data.requirementsNote,
      },
      select: BOOKING_FIELDS,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
