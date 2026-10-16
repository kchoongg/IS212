import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { expireDueHolds } from "@/lib/holdExpiryService";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { eventReference, parseEventReference } from "@/lib/format";
import { canViewEvent, isAssignedCoordinator } from "@/lib/permissions";
import { notifyRole } from "@/lib/notifications";
import { SAFETY_CHECK_PENDING_MESSAGE, checkSafetySubmission } from "@/lib/safetyCheck";
import { transitionError } from "@/lib/statuses";

/**
 * SPM-86 — submit an event for an Operational Safety Check.
 *
 *   POST /api/events/EVT-000123/safety-check
 *
 * The assigned coordinator (AC7) submits an event in Planning once its venue
 * and equipment are held and none is flagged for review (AC1, AC2 - the rule
 * is checkSafetySubmission() in src/lib/safetyCheck.ts). In one transaction
 * the event moves to Safety review (AC3), a pending SafetyCheck records who
 * submitted it and when (AC8), the move goes into the status history, and
 * every active Safety Officer is notified (AC5).
 *
 * The only way into Safety review: the status PATCH refuses it.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    const sequenceNumber = parseEventReference(id);
    const event =
      sequenceNumber === null ? null : await prisma.event.findUnique({ where: { sequenceNumber } });
    // Same order as every other event route: an event the user cannot see is
    // 404 before any role check, so its existence is never confirmed.
    if (!event || !canViewEvent(actor, event)) {
      return hidden();
    }
    if (!isAssignedCoordinator(actor, event)) {
      return forbidden("Only the assigned Coordinator can submit this event for a safety check");
    }

    // AC6: a check is already pending - said plainly rather than as a
    // lifecycle refusal, since that is what the coordinator needs to know.
    if (event.status === "safety_review") {
      return NextResponse.json({ error: SAFETY_CHECK_PENDING_MESSAGE }, { status: 400 });
    }
    if (event.status !== "planning") {
      return NextResponse.json({ error: transitionError(event.status, "safety_review") }, { status: 400 });
    }

    // SPM-82: an expired hold is not a venue arrangement.
    await expireDueHolds();
    const [sessions, bookings, equipment] = await Promise.all([
      prisma.eventSession.findMany({
        where: { eventId: event.id },
        select: { id: true, label: true },
      }),
      prisma.venueBooking.findMany({
        where: { eventId: event.id },
        // notRequired: an arrangement the coordinator waived on the Readiness tab (SPM-33).
        select: { sessionId: true, status: true, needsReview: true, reviewReason: true, notRequired: true, venue: { select: { name: true } } },
      }),
      prisma.equipmentRequest.findMany({
        where: { eventId: event.id },
        select: { sessionId: true, status: true, needsReview: true, reviewReason: true, notRequired: true, equipment: { select: { name: true } } },
      }),
    ]);

    const readiness = checkSafetySubmission({
      sessions,
      bookings: bookings.map((b) => ({ ...b, venueName: b.venue.name })),
      equipment: equipment.map((e) => ({ ...e, equipmentName: e.equipment.name })),
    });
    if (!readiness.ok) {
      return NextResponse.json({ error: readiness.error, outstanding: readiness.outstanding }, { status: 400 });
    }

    const submitter = await prisma.user.findUnique({ where: { id: actor.id }, select: { fullName: true } });
    const now = new Date();

    const check = await prisma.$transaction(async (tx) => {
      // updateMany so the status is re-checked in the database: a second
      // submission (another tab, a double click) finds the event already
      // moved and writes nothing (AC6).
      const moved = await tx.event.updateMany({
        where: { id: event.id, status: "planning" },
        data: { status: "safety_review" },
      });
      if (moved.count === 0) return null;

      const created = await tx.safetyCheck.create({
        data: { eventId: event.id, status: "pending", submittedBy: actor.id, submittedAt: now },
      });
      await tx.eventStatusHistory.create({
        data: {
          eventId: event.id,
          fromStatus: "planning",
          toStatus: "safety_review",
          changedBy: actor.id,
          changedAt: now,
          reason: "Submitted for an operational safety check",
        },
      });
      await notifyRole(tx, "safety_officer", {
        type: "safety_check_submitted",
        title: "Event submitted for safety check",
        body: `${event.title ?? "An event"} (${eventReference(event.sequenceNumber)}) is ready for an Operational Safety Check.`,
        eventId: event.id,
      });
      return created;
    });

    if (!check) {
      return NextResponse.json({ error: SAFETY_CHECK_PENDING_MESSAGE }, { status: 400 });
    }

    return NextResponse.json({
      status: "safety_review",
      safetyCheck: {
        status: check.status,
        submittedAt: check.submittedAt,
        submittedBy: submitter?.fullName ?? null,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
