import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { eventReference, parseEventReference } from "@/lib/format";
import { can } from "@/lib/permissions";
import { notifyUser } from "@/lib/notifications";
import {
  DECISION_HISTORY_REASON,
  SAFETY_CHECK_DECIDED_MESSAGE,
  decisionNotification,
  safetyDecisionSchema,
  statusAfterDecision,
} from "@/lib/safetyDecision";
import { canViewEventWithHistory } from "@/lib/eventVisibility";

/**
 * SPM-87 — the Safety Officer records their decision on an event's
 * Operational Safety Check.
 *
 *   POST /api/events/EVT-000123/safety-decision
 *   { decision: "approved" | "changes_requested" | "rejected", note? }
 *
 * Only the Safety Officer (AC12), only for an event in Safety review, and once
 * per submission (AC11). In one transaction: the event's pending SafetyCheck
 * gets the decision, who and when (AC10); the event moves to Safety approved
 * (AC7) or back to Planning (AC8); the move goes into the status history; and
 * the assigned Coordinator is notified with the reason or changes (AC9).
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
    if (!event || !(await canViewEventWithHistory(actor, event))) {
      return hidden();
    }
    if (!can(actor.role, "event:safety_check")) {
      return forbidden("Only the Safety Officer can record a safety decision");
    }

    const data = safetyDecisionSchema.parse(await req.json());

    const check = await prisma.safetyCheck.findFirst({
      where: { eventId: event.id },
      orderBy: { submittedAt: "desc" },
      select: { id: true, status: true, submittedBy: true },
    });
    if (event.status !== "safety_review" || !check || check.status !== "pending") {
      return NextResponse.json({ error: SAFETY_CHECK_DECIDED_MESSAGE }, { status: 400 });
    }

    const note = data.decision === "approved" ? null : data.note;
    const next = statusAfterDecision(data.decision);
    const decider = await prisma.user.findUnique({ where: { id: actor.id }, select: { fullName: true } });
    const now = new Date();

    const decided = await prisma.$transaction(async (tx) => {
      // Guarded on "pending", so two decisions at once (two tabs, a double
      // click) save only the first (AC11).
      const saved = await tx.safetyCheck.updateMany({
        where: { id: check.id, status: "pending" },
        data: { status: data.decision, decidedBy: actor.id, decidedAt: now, decisionNote: note },
      });
      if (saved.count === 0) return false;

      await tx.event.updateMany({
        where: { id: event.id, status: "safety_review" },
        data: { status: next },
      });
      await tx.eventStatusHistory.create({
        data: {
          eventId: event.id,
          fromStatus: "safety_review",
          toStatus: next,
          changedBy: actor.id,
          changedAt: now,
          reason: DECISION_HISTORY_REASON[data.decision],
        },
      });
      // The assigned Coordinator, or whoever submitted it while it has none.
      await notifyUser(tx, event.coordinatorId ?? check.submittedBy, {
        ...decisionNotification(
          data.decision,
          `${event.title ?? "an event"} (${eventReference(event.sequenceNumber)})`,
          note ?? undefined
        ),
        eventId: event.id,
      });
      return true;
    });

    if (!decided) {
      return NextResponse.json({ error: SAFETY_CHECK_DECIDED_MESSAGE }, { status: 400 });
    }

    return NextResponse.json({
      status: next,
      safetyCheck: { status: data.decision, decidedAt: now, decidedBy: decider?.fullName ?? null, decisionNote: note },
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
