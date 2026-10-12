import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { can } from "@/lib/permissions";
import { recordOutOfServiceSchema } from "@/lib/validation";
import { checkOutOfService, outOfServiceReasonFor } from "@/lib/equipment";
import {
  COMMITTING_REQUEST_STATUSES,
  RELEASED_EVENT_STATUSES,
  transferLeadFor,
} from "@/lib/equipmentAvailability";
import { venueFor } from "@/lib/equipmentAvailabilityService";
import {
  EQUIPMENT_UNAVAILABLE_REASON,
  newlyShortReservations,
  outOfServiceTypeLabel,
} from "@/lib/equipmentOutOfService";
import { addReviewReasons } from "@/lib/reviewFlags";
import { notifyUser } from "@/lib/notifications";
import { formatDateTimeRange } from "@/lib/format";

// SPM-48 AC7 ("equipment recorded as unavailable is excluded") and SPM-55
// (Record Equipment Unavailability). Technical Support say how many units of
// an item are unavailable, damaged or under maintenance, which of the three it
// is, and why (customer Q&A #9: Technical Support Staff maintain equipment
// status). The availability check already subtracts that number. Returning
// units is the same request with a lower number, down to 0 (AC5).
//
// SPM-55 AC4: a reservation the units left can no longer cover is flagged for
// review - never cancelled or reduced - and its event's coordinator notified.
// Only reservations that were covered before this change are flagged, so a
// second save, or returning units, never repeats a notification.
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    if (!can(actor.role, "equipment:manage")) {
      return forbidden("Only Technical Support Staff can record equipment as unavailable");
    }

    const data = recordOutOfServiceSchema.parse(await req.json());

    const item = await prisma.equipment.findUnique({
      where: { id },
      select: {
        name: true,
        totalQuantity: true,
        quantityInMaintenance: true,
        isActive: true,
        locationVenueId: true,
      },
    });
    if (!item) {
      return NextResponse.json({ error: "Equipment not found" }, { status: 404 });
    }
    const problem = checkOutOfService(item.totalQuantity, data.quantityOutOfService);
    if (problem) {
      return NextResponse.json({ error: problem }, { status: 400 });
    }

    const now = new Date();
    const out = data.quantityOutOfService;

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.equipment.update({
        where: { id },
        data: {
          quantityInMaintenance: out,
          outOfServiceType: out === 0 ? null : (data.type ?? null),
          outOfServiceReason: outOfServiceReasonFor(out, data.reason),
        },
      });

      const held =
        (await tx.equipmentRequest.findMany({
          where: {
            equipmentId: id,
            status: { in: COMMITTING_REQUEST_STATUSES },
            event: { status: { notIn: RELEASED_EVENT_STATUSES }, endsAt: { gt: now } },
          },
          select: {
            id: true,
            eventId: true,
            quantityReserved: true,
            requestedBy: true,
            needsReview: true,
            reviewReason: true,
            sessionId: true,
            session: { select: { label: true, startsAt: true, endsAt: true } },
            event: {
              select: {
                title: true,
                coordinatorId: true,
                startsAt: true,
                endsAt: true,
                venueBookings: { select: { venueId: true, sessionId: true, status: true } },
              },
            },
          },
        })) ?? [];

      const rows = held.filter((r) => (r.session?.startsAt ?? r.event.startsAt) && (r.session?.endsAt ?? r.event.endsAt));
      const short = newlyShortReservations(
        { totalQuantity: item.totalQuantity, isActive: item.isActive },
        item.quantityInMaintenance ?? 0,
        out,
        rows.map((r) => ({
          requestId: r.id,
          eventTitle: r.event.title,
          quantityReserved: r.quantityReserved ?? 0,
          startsAt: (r.session?.startsAt ?? r.event.startsAt)!,
          endsAt: (r.session?.endsAt ?? r.event.endsAt)!,
          transferLeadMs: transferLeadFor(item.locationVenueId ?? null, venueFor(r.event.venueBookings, r.sessionId)).leadMs,
        }))
      );

      const what = [data.type ? outOfServiceTypeLabel(data.type).toLowerCase() : "out of service", data.reason?.trim()]
        .filter(Boolean)
        .join(": ");
      const flaggedReservations = [];
      for (const s of short) {
        const row = rows.find((r) => r.id === s.requestId)!;
        await tx.equipmentRequest.update({
          where: { id: row.id },
          data: {
            needsReview: true,
            reviewReason: addReviewReasons(row.needsReview ? row.reviewReason : null, [EQUIPMENT_UNAVAILABLE_REASON]),
            flaggedAt: now,
          },
        });
        // The assigned Coordinator, or whoever requested it while the event
        // has none - the same fallback as SPM-39 and SPM-45.
        await notifyUser(tx, row.event.coordinatorId ?? row.requestedBy, {
          type: "equipment_unavailable",
          title: "Equipment out of service - reservation needs review",
          body:
            `${item.name}: ${out} of ${item.totalQuantity} units are now out of service (${what}). ` +
            `The reservation of ${s.quantityReserved} for ${row.event.title ?? "an event"}` +
            `${row.session?.label ? ` (${row.session.label})` : ""} on ${formatDateTimeRange(s.startsAt, s.endsAt)} ` +
            `now has ${s.available} available. It is flagged for review - nothing has been changed or cancelled.`,
          eventId: row.eventId,
        });
        flaggedReservations.push({
          requestId: row.id,
          eventId: row.eventId,
          eventTitle: row.event.title,
          sessionLabel: row.session?.label ?? null,
          reserved: s.quantityReserved,
          available: s.available,
        });
      }

      return { ...updated, flaggedReservations };
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
