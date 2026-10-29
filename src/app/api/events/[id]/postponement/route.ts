import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { parseEventReference } from "@/lib/format";
import { canSetEventStatus } from "@/lib/permissions";
import { canTransition, transitionError } from "@/lib/statuses";
import { postponementConsequences } from "@/lib/eventPostponement";
import { canViewEventWithHistory } from "@/lib/eventVisibility";

/**
 * SPM-38 — what postponing this event would let go, for the Postpone event
 * dialog, as GET .../cancellation does for Cancel event (SPM-37).
 *
 *   GET /api/events/EVT-000123/postponement -> { consequences: string[] }
 *
 * Read-only: postponing is PATCH /api/events/[id] { status: "postponed" },
 * which lets go of the same things (src/lib/eventPostponement.ts). Only the
 * assigned coordinator may ask (AC2), and only while the event can be
 * postponed (AC1).
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
    if (!event || !(await canViewEventWithHistory(actor, event))) {
      return hidden();
    }
    if (!canSetEventStatus(actor, event, "postponed")) {
      return forbidden("Only the assigned Coordinator can postpone this event.");
    }
    if (!canTransition(event.status, "postponed")) {
      return NextResponse.json({ error: transitionError(event.status, "postponed") }, { status: 400 });
    }

    const [bookings, equipment, pendingPostponementRequests, openCheck, registrations] = await Promise.all([
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
      prisma.eventChangeRequest.count({ where: { eventId: event.id, status: "pending", kind: "postpone" } }),
      prisma.safetyCheck.findFirst({
        where: { eventId: event.id, status: { in: ["pending", "approved"] } },
        select: { status: true },
        orderBy: { submittedAt: "desc" },
      }),
      prisma.registration.groupBy({ by: ["status"], where: { eventId: event.id }, _count: { _all: true } }),
    ]);

    const count = (status: string) => registrations.find((r) => r.status === status)?._count._all ?? 0;
    return NextResponse.json({
      consequences: postponementConsequences({
        bookings,
        equipment,
        pendingPostponementRequests,
        safetyCheck: (openCheck?.status as "pending" | "approved" | undefined) ?? null,
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
