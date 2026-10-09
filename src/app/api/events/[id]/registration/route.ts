import { NextRequest, NextResponse } from "next/server";
import type { Event } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { parseEventReference } from "@/lib/format";
import { EVENT_INFORMATION_STATUSES, canConfigureRegistration, canViewEvent } from "@/lib/permissions";
import { configureRegistrationSchema } from "@/lib/validation";
import {
  capacityError,
  liveBookings,
  measuredBooking,
  periodErrors,
  registrationFlagLine,
  registrationReviewReasons,
  startedError,
  HOLDING_A_PLACE,
} from "@/lib/registrationSettings";
import { addReviewReasons } from "@/lib/reviewFlags";

// Configure Event Registration (SPM-64): the assigned coordinator sets up
// attendee registration for an event. The rules are
// src/lib/registrationSettings.ts. Same shape as Update Event
// Information (SPM-62, ../information/route.ts): 401, then 404 for an event
// the user may not see, then 403, then the status window, then validation.

const BOOKING_FIELDS = {
  id: true,
  status: true,
  layoutName: true,
  venue: { select: { name: true, code: true, layouts: { select: { layoutName: true, capacity: true } } } },
} as const;

/// Who is asking, and the event if they are its assigned coordinator - or the
/// refusal to send instead (401, 404 for an event they may not see, 403).
async function coordinatorsEvent(
  req: NextRequest,
  id: string
): Promise<{ refusal: NextResponse; event?: never } | { event: Event; refusal?: never }> {
  const actor = await getActor(req);
  if (!actor) return { refusal: unauthenticated() };

  const sequenceNumber = parseEventReference(id);
  const event = sequenceNumber === null ? null : await prisma.event.findUnique({ where: { sequenceNumber } });
  // An event the user may not see is 404, never 403 - a 403 would confirm it exists.
  if (!event || !canViewEvent(actor, event)) return { refusal: hidden() };
  if (!canConfigureRegistration(actor, event)) {
    return { refusal: forbidden("Only the coordinator assigned to this event can change its registration settings") };
  }
  return { event };
}

/// AC4: the bookings the coordinator's form offers under 'Capacity measured
/// against' - the active ones, each with its room's capacity in the booked
/// layout (null when it has none). Asked for only when the form opens.
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const found = await coordinatorsEvent(req, id);
    if (found.refusal) return found.refusal;

    const bookings = await prisma.venueBooking.findMany({ where: { eventId: found.event.id }, select: BOOKING_FIELDS });
    return NextResponse.json({
      bookings: liveBookings(bookings).map((b) => ({
        id: b.id,
        status: b.status,
        layoutName: b.layoutName,
        layoutCapacity: b.venue.layouts.find((l) => l.layoutName === b.layoutName)?.capacity ?? null,
        venue: { name: b.venue.name, code: b.venue.code },
      })),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const found = await coordinatorsEvent(req, id);
    if (found.refusal) return found.refusal;
    const { event } = found;

    if (!EVENT_INFORMATION_STATUSES.includes(event.status)) {
      return NextResponse.json(
        { error: "Registration settings can only be changed while the event is Approved, Planning or Confirmed." },
        { status: 400 }
      );
    }

    const data = configureRegistrationSchema.parse(await req.json());

    // AC3, AC4: the capacity is measured against one of the event's bookings,
    // checked whenever the capacity or that booking changes. The bookings are
    // read only then.
    let measuredBookingId: string | undefined;
    if (data.registrationCapacity !== undefined || data.registrationVenueBookingId !== undefined) {
      const bookings = await prisma.venueBooking.findMany({ where: { eventId: event.id }, select: BOOKING_FIELDS });
      const measured = measuredBooking(bookings, data.registrationVenueBookingId, event.registrationVenueBookingId);
      if (!measured.ok) {
        return fieldError(measured.field, measured.error);
      }
      const capacity = data.registrationCapacity ?? event.registrationCapacity;
      const error = capacity == null ? null : capacityError(capacity, measured.booking);
      if (error) {
        return fieldError("registrationCapacity", error);
      }
      measuredBookingId = measured.booking.id;
    }

    // AC5-AC7: the period as it will be once saved.
    const opensAt = data.registrationOpensAt !== undefined ? new Date(data.registrationOpensAt) : undefined;
    const closesAt = data.registrationClosesAt !== undefined ? new Date(data.registrationClosesAt) : undefined;
    if (opensAt !== undefined || closesAt !== undefined) {
      // AC7: shown under the date being changed.
      const started = startedError(event.startsAt, new Date());
      if (started) return fieldError(closesAt !== undefined ? "registrationClosesAt" : "registrationOpensAt", started);

      const errors = periodErrors(
        { opensAt: opensAt ?? event.registrationOpensAt, closesAt: closesAt ?? event.registrationClosesAt },
        event.startsAt
      );
      const [field] = Object.keys(errors);
      if (field) return fieldError(field, errors[field]);
    }

    // AC9: a lower capacity or registration turned off may take places from
    // attendees who hold one. The registrations are flagged, never changed.
    // Counted only for a change that could do that.
    const before = { enabled: event.registrationEnabled, capacity: event.registrationCapacity };
    const after = {
      enabled: data.registrationEnabled ?? before.enabled,
      capacity: data.registrationCapacity ?? before.capacity,
    };
    const couldTakePlaces = after.capacity !== before.capacity || (before.enabled && !after.enabled);
    const holdingAPlace = couldTakePlaces
      ? await prisma.registration.count({ where: { eventId: event.id, status: { in: HOLDING_A_PLACE } } })
      : 0;
    const reasons = registrationReviewReasons(before, after, holdingAPlace);

    // Turning registration off keeps the saved capacity and period, so turning
    // it back on restores them (decided 2026-10-09).
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: {
        ...(data.registrationEnabled !== undefined ? { registrationEnabled: data.registrationEnabled } : {}),
        ...(data.registrationCapacity !== undefined ? { registrationCapacity: data.registrationCapacity } : {}),
        ...(measuredBookingId !== undefined ? { registrationVenueBookingId: measuredBookingId } : {}),
        ...(opensAt !== undefined ? { registrationOpensAt: opensAt } : {}),
        ...(closesAt !== undefined ? { registrationClosesAt: closesAt } : {}),
        ...(reasons.length > 0
          ? { registrationReviewReason: addReviewReasons(event.registrationReviewReason, reasons) }
          : {}),
      },
    });
    // What THIS save flagged, worded for the person who made it (as SPM-62).
    const flagged = reasons.length > 0 ? [registrationFlagLine(holdingAPlace, reasons)] : [];
    return NextResponse.json({ event: updated, flagged });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/// Keyed by field so readServerError() (src/lib/formErrors.ts) shows the
/// message under that field, as the information route does.
function fieldError(field: string, error: string) {
  return NextResponse.json({ error, details: { fieldErrors: { [field]: [error] } } }, { status: 400 });
}
