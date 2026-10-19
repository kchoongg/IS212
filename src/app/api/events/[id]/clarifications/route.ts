import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { parseEventReference } from "@/lib/format";
import { REVIEWABLE_STATUSES, canRequestClarification, canViewEvent } from "@/lib/permissions";
import {
  CLARIFICATION_ALREADY_OPEN,
  CLARIFICATION_FORBIDDEN_MESSAGE,
  CLARIFICATION_NOT_UNDER_REVIEW,
  clarificationProblem,
  clarificationSchema,
  decodeFields,
  encodeFields,
} from "@/lib/clarification";

/// A refusal decided inside the transaction, turned into a 400 outside it.
class AlreadyOpen extends Error {}

/**
 * SPM-29 - the coordinator assigned to an event that is Under review asks
 * the organiser to clarify parts of the request.
 *
 *   POST /api/events/EVT-000123/clarifications
 *   { fields: ["purpose", "when"], message: "Which day?" }
 *
 * The event stays Under review: nothing here writes the event or its status
 * history (AC3). One clarification is open at a time, checked in the same
 * transaction that opens it. Notifying the organiser is SPM-53's.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    const sequenceNumber = parseEventReference(id);
    const event = sequenceNumber === null ? null : await prisma.event.findUnique({ where: { sequenceNumber } });
    if (!event || !canViewEvent(actor, event)) {
      return hidden();
    }
    if (!canRequestClarification(actor, event)) {
      return forbidden(CLARIFICATION_FORBIDDEN_MESSAGE);
    }

    const { fields, message } = clarificationSchema.parse(await req.json());
    const problem = clarificationProblem({ fields, message });
    if (problem) {
      return NextResponse.json({ error: problem }, { status: 400 });
    }
    if (!REVIEWABLE_STATUSES.includes(event.status)) {
      return NextResponse.json({ error: CLARIFICATION_NOT_UNDER_REVIEW }, { status: 400 });
    }

    const created = await prisma.$transaction(async (tx) => {
      const open = await tx.clarificationRequest.findFirst({ where: { eventId: event.id, status: "open" } });
      if (open) throw new AlreadyOpen();
      return tx.clarificationRequest.create({
        data: { eventId: event.id, requestedBy: actor.id, message: message.trim(), fields: encodeFields(fields) },
        include: { requester: { select: { fullName: true } } },
      });
    });

    return NextResponse.json(
      {
        id: created.id,
        fields: decodeFields(created.fields),
        message: created.message,
        requestedAt: created.requestedAt,
        requester: created.requester,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof AlreadyOpen) {
      return NextResponse.json({ error: CLARIFICATION_ALREADY_OPEN }, { status: 400 });
    }
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
