import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { parseEventReference } from "@/lib/format";
import { canSetEventStatus, canViewEvent } from "@/lib/permissions";
import { canTransition, transitionError } from "@/lib/statuses";
import { cancellationConsequences } from "@/lib/eventCancellation";

/**
 * SPM-37 — what cancelling this event would let go, for the Cancel event
 * dialog (UI_DESIGN.md §7.4, §7.5: it names the consequences).
 *
 *   GET /api/events/EVT-000123/cancellation -> { consequences: string[] }
 *
 * Read-only: cancelling is PATCH /api/events/[id] { status: "cancelled" },
 * which lets go of the same things (src/lib/eventCancellation.ts). Only the
 * assigned coordinator may ask (AC2), and only while the event can be
 * cancelled (AC1, AC9).
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    const sequenceNumber = parseEventReference(id);
    const event =
      sequenceNumber === null ? null : await prisma.event.findUnique({ where: { sequenceNumber } });
    // An event the user cannot see is 404 before any role check.
    if (!event || !canViewEvent(actor, event)) {
      return hidden();
    }
    if (!canSetEventStatus(actor, event, "cancelled")) {
      return forbidden("Only the assigned Coordinator can cancel this event.");
    }
    if (!canTransition(event.status, "cancelled")) {
      return NextResponse.json({ error: transitionError(event.status, "cancelled") }, { status: 400 });
    }

    const [bookings, equipment, pendingChangeRequests, pendingChecks, registrations] = await Promise.all([
      prisma.venueBooking.findMany({
        where: { eventId: event.id, status: { in: ["approved", "pending"] } },
        select: {
          status: true,
          startsAt: true,
          endsAt: true,
          venue: { select: { name: true, code: true } },
          session: { select: { label: true } },
        },
        orderBy: { startsAt: "asc" },
      }),
      prisma.equipmentRequest.findMany({
        where: { eventId: event.id, status: { not: "cancelled" } },
        select: { status: true, quantityRequested: true, quantityReserved: true, equipment: { select: { name: true } } },
        orderBy: { requestedAt: "asc" },
      }),
      prisma.eventChangeRequest.count({ where: { eventId: event.id, status: "pending" } }),
      prisma.safetyCheck.count({ where: { eventId: event.id, status: "pending" } }),
      prisma.registration.groupBy({ by: ["status"], where: { eventId: event.id }, _count: { _all: true } }),
    ]);

    const count = (status: string) => registrations.find((r) => r.status === status)?._count._all ?? 0;
    return NextResponse.json({
      consequences: cancellationConsequences({
        bookings,
        equipment,
        pendingChangeRequests,
        safetyCheckPending: pendingChecks > 0,
        registration: {
          enabled: event.registrationEnabled,
          registered: count("registered"),
          waitlisted: count("waitlisted"),
        },
      }),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
