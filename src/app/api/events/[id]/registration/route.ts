import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { parseEventReference } from "@/lib/format";
import { EVENT_INFORMATION_STATUSES, canConfigureRegistration, canViewEvent } from "@/lib/permissions";
import { configureRegistrationSchema } from "@/lib/validation";
import { capacityError, measuredBooking } from "@/lib/registrationSettings";

// Configure Event Registration (SPM-64): the assigned coordinator sets up
// attendee registration for an event. The rules are
// src/lib/registrationSettings.ts. Same shape as Update Event
// Information (SPM-62, ../information/route.ts): 401, then 404 for an event
// the user may not see, then 403, then the status window, then validation.

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    const sequenceNumber = parseEventReference(id);
    const event = sequenceNumber === null ? null : await prisma.event.findUnique({ where: { sequenceNumber } });
    // An event the user may not see is 404, never 403 - a 403 would confirm it exists.
    if (!event || !canViewEvent(actor, event)) {
      return hidden();
    }
    if (!canConfigureRegistration(actor, event)) {
      return forbidden("Only the coordinator assigned to this event can change its registration settings");
    }
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
      const bookings = await prisma.venueBooking.findMany({
        where: { eventId: event.id },
        select: {
          id: true,
          status: true,
          layoutName: true,
          venue: { select: { name: true, code: true, layouts: { select: { layoutName: true, capacity: true } } } },
        },
      });
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

    // Turning registration off keeps the saved capacity and period, so turning
    // it back on restores them (decided 2026-10-09).
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: {
        ...(data.registrationEnabled !== undefined ? { registrationEnabled: data.registrationEnabled } : {}),
        ...(data.registrationCapacity !== undefined ? { registrationCapacity: data.registrationCapacity } : {}),
        ...(measuredBookingId !== undefined ? { registrationVenueBookingId: measuredBookingId } : {}),
      },
    });
    return NextResponse.json({ event: updated, flagged: [] });
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
