import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { can, type Actor } from "@/lib/permissions";
import { reviewFlaggedArrangementSchema } from "@/lib/validation";
import { HOLDING_A_PLACE } from "@/lib/registrationSettings";
import { TERMINAL_EVENT_STATUSES } from "@/lib/statuses";
import { flagReasons, keepRefusal } from "@/lib/flaggedArrangements";
import {
  FLAGGED_BOOKING_SELECT,
  FLAGGED_EQUIPMENT_SELECT,
  REVIEWABLE_BOOKING_STATUSES,
  REVIEWABLE_EQUIPMENT_STATUSES,
  assessBookingRow,
  assessEquipmentRow,
  eventSummary,
} from "@/lib/flaggedArrangementsService";

// SPM-68, Review Flagged Arrangements - the data behind the Coordinator's
// Flagged Arrangements page (/flagged).
//
// GET lists every flagged venue booking, equipment reservation and
// registration list on the events assigned to the signed-in Coordinator
// (AC1, AC16), each with why it was flagged and its result for the event as
// it is NOW (AC2, AC4, AC5, AC8).
//
// POST keeps one, or marks an event's registrations as reviewed. It writes
// the flag and nothing else (AC6, AC9, AC14), and refuses to keep an
// arrangement that no longer meets the event's requirements, naming what is
// unmet (AC7). Every rule is in src/lib/flaggedArrangements.ts.
//
// Replacing a booking needs nothing here: the page searches with
// /venues/search and requests with POST /api/events/[id]/venue-bookings; the
// old booking is released on the event's Venue tab (SPM-67). A withdrawn or
// released booking is no longer read, so it leaves the list.

const ONLY_COORDINATORS = "Flagged arrangements are for Event Coordinators";
const NOT_ASSIGNED = "Only the assigned Coordinator can review this event's flagged arrangements.";
const NOT_FLAGGED = "This arrangement is not flagged for review.";
const NOT_FOUND = "This arrangement could not be found.";
/// The same three limits GET lists by, so nothing can be kept or reviewed
/// that the page would never show - a direct request included.
const EVENT_CLOSED = "This event is completed, cancelled, rejected or withdrawn, so its flags are no longer reviewed.";
const NOTHING_HELD = "This arrangement no longer holds anything, so there is nothing to review.";

const eventClosed = (event: { status: string }) => TERMINAL_EVENT_STATUSES.includes(event.status);

/// The page is the Coordinator's own work list, like the Readiness tab it
/// feeds: it reuses `event:confirm`, the action a flag stands in the way of
/// (canViewArrangements(), src/lib/permissions.ts).
function mayReview(actor: Actor): boolean {
  return can(actor.role, "event:confirm");
}

const refuse = (error: string, status: number) => NextResponse.json({ error }, { status });

function serverError(err: unknown) {
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    if (!mayReview(actor)) {
      return forbidden(ONLY_COORDINATORS);
    }

    // AC16: only this Coordinator's events. AC3: only what is flagged, so an
    // event's other bookings are never read. Not an event that is over or
    // called off: there is nothing left for a flag to go wrong with, and the
    // stories that raise flags skip finished arrangements for the same reason.
    const mine = { coordinatorId: actor.id, status: { notIn: TERMINAL_EVENT_STATUSES } };
    const [bookings, equipment, events] = await Promise.all([
      prisma.venueBooking.findMany({
        where: { needsReview: true, status: { in: REVIEWABLE_BOOKING_STATUSES }, event: mine },
        orderBy: { flaggedAt: "desc" },
        select: FLAGGED_BOOKING_SELECT,
      }),
      prisma.equipmentRequest.findMany({
        where: { needsReview: true, status: { in: REVIEWABLE_EQUIPMENT_STATUSES }, event: mine },
        orderBy: { flaggedAt: "desc" },
        select: FLAGGED_EQUIPMENT_SELECT,
      }),
      // Registrations are flagged on the event itself (SPM-62, SPM-64).
      prisma.event.findMany({
        where: { ...mine, registrationReviewReason: { not: null } },
        orderBy: { sequenceNumber: "asc" },
        select: {
          id: true,
          sequenceNumber: true,
          title: true,
          status: true,
          registrationReviewReason: true,
          registrations: { where: { status: { in: HOLDING_A_PLACE } }, select: { status: true } },
        },
      }),
    ]);

    const equipmentRequests = await Promise.all(
      equipment.map(async (r) => ({
        id: r.id,
        status: r.status,
        // Marked as not required on the Readiness tab (SPM-33): it no longer
        // blocks confirmation, but it is still flagged, so it is still listed.
        notRequired: r.notRequired === true,
        quantityRequested: r.quantityRequested,
        quantityReserved: r.quantityReserved,
        flaggedAt: r.flaggedAt,
        reasons: flagReasons(r.reviewReason),
        event: eventSummary(r.event),
        session: r.session ? { id: r.session.id, label: r.session.label } : null,
        equipment: { id: r.equipment.id, name: r.equipment.name },
        availability: await assessEquipmentRow(r),
      }))
    );

    return NextResponse.json({
      venueBookings: bookings.map((b) => ({
        id: b.id,
        status: b.status,
        notRequired: b.notRequired === true,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        layoutName: b.layoutName,
        // SPM-90: what the space is for; null on a booking made before it.
        purpose: b.purpose ?? null,
        flaggedAt: b.flaggedAt,
        reasons: flagReasons(b.reviewReason),
        event: eventSummary(b.event),
        session: b.session ? { id: b.session.id, label: b.session.label } : null,
        venue: { id: b.venue.id, code: b.venue.code, name: b.venue.name },
        ...assessBookingRow(b),
      })),
      equipmentRequests,
      registrations: events.map((e) => ({
        event: { id: e.id, ...eventSummary(e) },
        registered: e.registrations.filter((r) => r.status === "registered").length,
        waitlisted: e.registrations.filter((r) => r.status === "waitlisted").length,
        reasons: flagReasons(e.registrationReviewReason),
      })),
    });
  } catch (err) {
    return serverError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    if (!mayReview(actor)) {
      return forbidden(ONLY_COORDINATORS);
    }

    const { kind, id } = reviewFlaggedArrangementSchema.parse(await req.json());
    const assignedTo = (event: { coordinatorId: string | null }) => event.coordinatorId === actor.id;

    if (kind === "venue_booking") {
      const booking = await prisma.venueBooking.findUnique({ where: { id }, select: FLAGGED_BOOKING_SELECT });
      if (!booking) return refuse(NOT_FOUND, 404);
      if (!assignedTo(booking.event)) return forbidden(NOT_ASSIGNED);
      if (eventClosed(booking.event)) return refuse(EVENT_CLOSED, 400);
      if (!REVIEWABLE_BOOKING_STATUSES.includes(booking.status)) return refuse(NOTHING_HELD, 400);
      if (!booking.needsReview) return refuse(NOT_FLAGGED, 400);

      const { suitability, availability } = assessBookingRow(booking);
      const unmet = [...suitability.unmet, ...availability.unmet];
      if (unmet.length > 0) {
        return NextResponse.json({ error: keepRefusal(booking.venue.name, unmet), unmet }, { status: 400 });
      }
      // Only the flag. flaggedAt stays, as the record of when it was last flagged.
      await prisma.venueBooking.update({ where: { id }, data: { needsReview: false, reviewReason: null } });
    } else if (kind === "equipment_request") {
      const request = await prisma.equipmentRequest.findUnique({ where: { id }, select: FLAGGED_EQUIPMENT_SELECT });
      if (!request) return refuse(NOT_FOUND, 404);
      if (!assignedTo(request.event)) return forbidden(NOT_ASSIGNED);
      if (eventClosed(request.event)) return refuse(EVENT_CLOSED, 400);
      if (!REVIEWABLE_EQUIPMENT_STATUSES.includes(request.status)) return refuse(NOTHING_HELD, 400);
      if (!request.needsReview) return refuse(NOT_FLAGGED, 400);

      const availability = await assessEquipmentRow(request);
      if (!availability.ok) {
        const unmet = [availability.summary];
        return NextResponse.json({ error: keepRefusal(request.equipment.name, unmet), unmet }, { status: 400 });
      }
      await prisma.equipmentRequest.update({ where: { id }, data: { needsReview: false, reviewReason: null } });
    } else {
      // AC9: nothing to keep or refuse - who holds a place is not decided
      // here, and no registration is read or written.
      const event = await prisma.event.findUnique({
        where: { id },
        select: { coordinatorId: true, status: true, registrationReviewReason: true },
      });
      if (!event) return refuse(NOT_FOUND, 404);
      if (!assignedTo(event)) return forbidden(NOT_ASSIGNED);
      if (eventClosed(event)) return refuse(EVENT_CLOSED, 400);
      if (event.registrationReviewReason == null) return refuse(NOT_FLAGGED, 400);

      await prisma.event.update({ where: { id }, data: { registrationReviewReason: null } });
    }

    return NextResponse.json({ cleared: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    return serverError(err);
  }
}
