import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { parseEventReference } from "@/lib/format";
import { canViewEvent, canViewRegistrationList } from "@/lib/permissions";
import { registrationCounts } from "@/lib/registrationEligibility";

// View Registration List (SPM-65): who has registered for an event, for the
// Organiser responsible for it and the Coordinator assigned to it (AC1, AC8,
// AC9 - canViewRegistrationList()). Same order as the registration settings
// route (../registration/route.ts): 401, then 404 for an event the user may
// not see, then 403.
//
// Read fresh on every request (route handlers are not cached), so the
// Attendees tab, which asks again every 15 seconds, shows registrations,
// withdrawals and waiting-list changes as they happen (AC6).

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor(req);
    if (!actor) return unauthenticated();

    const { id } = await context.params;
    const sequenceNumber = parseEventReference(id);
    const event = sequenceNumber === null ? null : await prisma.event.findUnique({ where: { sequenceNumber } });
    // An event the user may not see is 404, never 403 - a 403 would confirm it exists.
    if (!event || !canViewEvent(actor, event)) return hidden();
    if (!canViewRegistrationList(actor, event)) {
      return forbidden("Only the event's organiser and its assigned coordinator can view its registrations");
    }

    const [registrations, byStatus] = await Promise.all([
      prisma.registration.findMany({
        where: { eventId: event.id },
        orderBy: { registeredAt: "asc" },
        select: {
          id: true,
          status: true,
          registeredAt: true,
          withdrawnAt: true,
          attendee: { select: { fullName: true, email: true, phone: true } },
          addedBy: { select: { fullName: true } },
        },
      }),
      prisma.registration.groupBy({ by: ["status"], where: { eventId: event.id }, _count: { _all: true } }),
    ]);

    return NextResponse.json({
      event: { sequenceNumber: event.sequenceNumber, title: event.title, status: event.status },
      // AC7: the page says registration is not enabled rather than showing an
      // empty list. Registrations made before it was turned off are still sent.
      registrationEnabled: event.registrationEnabled,
      // AC5: active registrations against this, and the waiting list.
      registrationCapacity: event.registrationCapacity,
      counts: registrationCounts(byStatus.map((s) => ({ status: s.status, count: s._count._all }))),
      registrations: registrations.map((r) => ({
        id: r.id,
        status: r.status,
        registeredAt: r.registeredAt,
        withdrawnAt: r.withdrawnAt,
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
