import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { parseEventReference } from "@/lib/format";
import { canProcessChangeRequests, canViewEvent } from "@/lib/permissions";
import { changeRequestDecisionSchema } from "@/lib/validation";
import { statusLabel } from "@/lib/statuses";
import { applyEventInformation, type EventForChange } from "@/lib/applyEventInformation";
import { canRequestChangeIn, describeChangeRequest, requestChanges, snapshotOf } from "@/lib/eventChangeRequest";
import {
  ALREADY_PROCESSED,
  APPROVE_CANCELLATION,
  EQUIPMENT_ITEM,
  NOT_ASSIGNED,
  POSTPONEMENT_NOT_YET,
  REQUEST_REASON_REQUIRED,
  RESCHEDULED_HISTORY,
  approvedPayload,
  checkApprovedTimes,
  checkDecisions,
  closedEventMessage,
  decisionItems,
  outcomeStatus,
  reschedules,
} from "@/lib/changeRequestDecision";

// Process Event Change Request (SPM-32): the assigned coordinator decides an
// organiser's change request (SPM-35). The rules are
// src/lib/changeRequestDecision.ts.
//
// A change of details is decided item by item; the approved fields are applied
// with Update Event Information's own rules (applyEventInformation, SPM-62) -
// the same flags, and the same move back to Planning (AC4). A Postponed event
// given a new date moves to Approved (AC5, SPM-38). A postponement or
// cancellation request is only rejected here: it is carried out by postponing
// (SPM-38) or cancelling (SPM-37) the event.
//
// The request is claimed first, conditionally on still being Pending, so two
// saves at once decide it once (AC7). Telling the organiser the outcome is
// Receive Event Notifications (SPM-53).

const WITH_PEOPLE = {
  requester: { select: { fullName: true } },
  reviewer: { select: { fullName: true } },
} as const;

class AlreadyProcessed extends Error {}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string; requestId: string }> }) {
  try {
    const { id, requestId } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    const sequenceNumber = parseEventReference(id);
    const event =
      sequenceNumber === null
        ? null
        : await prisma.event.findUnique({
            where: { sequenceNumber },
            include: { facilityRequirements: { select: { facilityId: true, facility: { select: { name: true } } } } },
          });
    if (!event || !canViewEvent(actor, event)) {
      return hidden();
    }
    const request = await prisma.eventChangeRequest.findUnique({ where: { id: requestId }, include: WITH_PEOPLE });
    if (!request || request.eventId !== event.id) {
      return hidden();
    }
    if (!canProcessChangeRequests(actor, event)) {
      return forbidden(NOT_ASSIGNED);
    }
    if (request.status !== "pending") {
      return NextResponse.json({ error: ALREADY_PROCESSED }, { status: 409 });
    }

    const body = changeRequestDecisionSchema.parse(await req.json());
    const snapshot = snapshotOf(event);
    const now = new Date();
    const reviewed = { reviewedBy: actor.id, reviewedAt: now };
    const claim = (data: Prisma.EventChangeRequestUpdateManyMutationInput) =>
      prisma.eventChangeRequest.updateMany({ where: { id: request.id, status: "pending" }, data });

    // A postponement or cancellation is carried out elsewhere; here it can only
    // be rejected, with a reason.
    if (request.kind !== "change") {
      if (body.outcome !== "rejected") {
        const error = request.kind === "cancel" ? APPROVE_CANCELLATION : POSTPONEMENT_NOT_YET;
        return NextResponse.json({ error }, { status: 400 });
      }
      const reason = body.reason?.trim();
      if (!reason) {
        return NextResponse.json({ error: REQUEST_REASON_REQUIRED }, { status: 400 });
      }
      const claimed = await claim({ status: "rejected", reviewNotes: reason, ...reviewed });
      if (claimed.count === 0) {
        return NextResponse.json({ error: ALREADY_PROCESSED }, { status: 409 });
      }
      const saved = await prisma.eventChangeRequest.findUnique({ where: { id: request.id }, include: WITH_PEOPLE });
      // v8 ignore next -- the row was claimed just above; `?? request` only satisfies the type
      return NextResponse.json(result(saved ?? request, snapshot));
    }

    const changes = requestChanges(request, snapshot);
    const checked = checkDecisions(decisionItems(changes, request.equipmentChanges), body.decisions ?? {});
    if (!checked.ok) {
      const details = checked.fieldErrors
        ? { fieldErrors: Object.fromEntries(Object.entries(checked.fieldErrors).map(([item, message]) => [item, [message]])) }
        : undefined;
      return NextResponse.json({ error: checked.error, ...(details ? { details } : {}) }, { status: 400 });
    }
    const { decisions } = checked;

    const approvesAnything = Object.values(decisions).some((d) => d.outcome === "approved");
    if (approvesAnything && !canRequestChangeIn(event.status)) {
      return NextResponse.json({ error: closedEventMessage(statusLabel(event.status)) }, { status: 400 });
    }
    const payload = approvedPayload(changes, decisions);
    const timesProblem = checkApprovedTimes(event, payload);
    if (timesProblem) {
      return NextResponse.json({ error: timesProblem }, { status: 400 });
    }

    const outcome = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Claimed first: if another save decided it, nothing below runs.
      const claimed = await tx.eventChangeRequest.updateMany({
        where: { id: request.id, status: "pending" },
        data: { status: outcomeStatus(decisions), decisions: decisions as unknown as Prisma.InputJsonValue, ...reviewed },
      });
      if (claimed.count === 0) throw new AlreadyProcessed();

      // AC4: the approved fields, with the same rules as a direct edit.
      const applied =
        Object.keys(payload).length > 0
          ? await applyEventInformation(tx, event as EventForChange, payload, actor.id, now)
          : null;

      // AC5: a Postponed event with its new date is ready for planning again.
      let rescheduled = false;
      if (reschedules(event.status, payload)) {
        const moved = await tx.event.updateMany({ where: { id: event.id, status: "postponed" }, data: { status: "approved" } });
        if (moved.count > 0) {
          await tx.eventStatusHistory.create({
            data: { eventId: event.id, fromStatus: "postponed", toStatus: "approved", changedBy: actor.id, reason: RESCHEDULED_HISTORY },
          });
          rescheduled = true;
        }
      }

      const saved = await tx.eventChangeRequest.findUnique({ where: { id: request.id }, include: WITH_PEOPLE });
      return { applied, rescheduled, saved };
    });

    return NextResponse.json(
      // v8 ignore next -- re-read inside the transaction that claimed it; as above
      result(outcome.saved ?? request, snapshot, {
        statusReverted: outcome.applied?.statusReverted ?? false,
        safetyCheckClosed: outcome.applied?.safetyCheckClosed ?? false,
        flagged: outcome.applied?.flagged ?? [],
        rescheduled: outcome.rescheduled,
        equipmentToDo: decisions[EQUIPMENT_ITEM]?.outcome === "approved",
      })
    );
  } catch (err) {
    if (err instanceof AlreadyProcessed) {
      return NextResponse.json({ error: ALREADY_PROCESSED }, { status: 409 });
    }
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function result(
  row: Parameters<typeof describeChangeRequest>[0],
  snapshot: Parameters<typeof describeChangeRequest>[1],
  effects = { statusReverted: false, safetyCheckClosed: false, flagged: [] as string[], rescheduled: false, equipmentToDo: false }
) {
  return { request: describeChangeRequest(row, snapshot), ...effects };
}
