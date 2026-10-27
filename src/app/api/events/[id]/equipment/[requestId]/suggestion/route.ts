import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, resolveEventId, unauthenticated } from "@/lib/apiAuth";
import {
  canDecideEquipmentSuggestion,
  canSuggestAlternativeEquipment,
  techSupportSeesEquipment,
} from "@/lib/permissions";
import { eventAllowsReserving, reservingClosedMessage } from "@/lib/equipmentAvailability";
import { loadAlternativeAvailability } from "@/lib/equipmentAvailabilityService";
import {
  DECISION_CLOSED_MESSAGE,
  acceptChanges,
  checkAcceptance,
  checkSuggestion,
  eventAllowsDecision,
  suggestedNotification,
} from "@/lib/equipmentSuggestion";
import { notifyUser } from "@/lib/notifications";
import { canViewEventWithHistory } from "@/lib/eventVisibility";
import { decideSuggestionSchema, suggestAlternativeSchema } from "@/lib/validation";

// SPM-77 — Suggest Alternative Equipment. POST: Technical Support records an
// alternative for a requirement they cannot provide, or can provide only in
// part (AC1-AC4). PATCH: the assigned Coordinator accepts or declines it
// (AC5, AC6). The rules are in src/lib/equipmentSuggestion.ts.
//
// A suggestion is a row of its own (EquipmentSuggestion). Recording one writes
// only that row and the Coordinator's notification - never the requirement
// (AC7) - so whatever the line has reserved stays reserved (AC8). Each line has
// at most one pending suggestion, so PATCH needs no suggestion id.
//
// Same visibility pattern as the sibling equipment routes: an event the caller
// cannot see is 404 (never reveals it exists), then the role check.

type Context = { params: Promise<{ id: string; requestId: string }> };

const UNIQUE_VIOLATION = "Unique constraint";

async function loadRequest(id: string, requestId: string) {
  const eventId = await resolveEventId(id);
  const existing = eventId
    ? await prisma.equipmentRequest.findUnique({
        where: { id: requestId },
        select: {
          eventId: true,
          equipmentId: true,
          status: true,
          quantityReserved: true,
          technicalRequirements: true,
          startsAt: true,
          endsAt: true,
          sessionId: true,
          equipment: { select: { name: true } },
          event: {
            select: {
              id: true,
              title: true,
              organiserId: true,
              organisationId: true,
              coordinatorId: true,
              status: true,
            },
          },
        },
      })
    : null;
  if (!existing || existing.eventId !== eventId) return null;
  return existing;
}

export async function POST(req: NextRequest, context: Context) {
  try {
    const { id, requestId } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    const existing = await loadRequest(id, requestId);
    if (!existing || !(await canViewEventWithHistory(actor, existing.event))) {
      return hidden();
    }
    if (!canSuggestAlternativeEquipment(actor)) {
      return forbidden("Only Technical Support Staff can suggest alternative equipment");
    }
    if (!techSupportSeesEquipment(existing.event.status)) {
      return hidden();
    }
    // Technical Support works on an event's equipment in Planning (BPMN), the
    // same window as reserving and updating it.
    if (!eventAllowsReserving(existing.event.status)) {
      return NextResponse.json({ error: reservingClosedMessage(existing.event.status) }, { status: 400 });
    }

    const data = suggestAlternativeSchema.parse(await req.json());
    const note = data.note.trim();

    const created = await prisma.$transaction(async (tx) => {
      // AC2 again, at the moment of recording: the form showed it a moment ago.
      const checked = await loadAlternativeAvailability(tx, requestId, data.equipmentId, data.quantity);
      if (!checked) throw new RouteError(400, "This request no longer exists.");

      const pending = await tx.equipmentSuggestion.findFirst({ where: { requestId, status: "pending" } });
      const alreadyRequested = await tx.equipmentRequest.findFirst({
        where: { eventId: existing.eventId, sessionId: existing.sessionId, equipmentId: data.equipmentId },
      });
      const refusal = checkSuggestion({
        requestStatus: existing.status,
        requestEquipmentId: existing.equipmentId,
        hasPending: pending !== null,
        alternative: checked.alternative,
        alreadyRequested: alreadyRequested !== null,
        quantity: data.quantity,
        note,
        available: checked.result?.available ?? null,
      });
      if (refusal) throw new RouteError(400, refusal);

      const suggestion = await tx.equipmentSuggestion.create({
        data: {
          requestId,
          equipmentId: data.equipmentId,
          quantity: data.quantity,
          note,
          status: "pending",
          suggestedBy: actor.id,
        },
        include: { equipment: { select: { id: true, name: true } } },
      });
      if (existing.event.coordinatorId) {
        await notifyUser(
          tx,
          existing.event.coordinatorId,
          suggestedNotification({
            eventId: existing.event.id,
            eventTitle: existing.event.title,
            equipmentName: existing.equipment.name,
            alternativeName: suggestion.equipment.name,
            quantity: data.quantity,
            note,
          })
        );
      }
      return suggestion;
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    // The partial unique index: another suggestion was recorded at the same moment.
    if (err instanceof Error && err.message.includes(UNIQUE_VIOLATION)) {
      return NextResponse.json(
        { error: "This item already has a suggestion waiting for the Coordinator's decision." },
        { status: 409 }
      );
    }
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest, context: Context) {
  try {
    const { id, requestId } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    const existing = await loadRequest(id, requestId);
    if (!existing || !(await canViewEventWithHistory(actor, existing.event))) {
      return hidden();
    }
    if (!canDecideEquipmentSuggestion(actor, existing.event)) {
      return forbidden("Only the assigned Coordinator can accept or decline a suggestion");
    }
    if (!eventAllowsDecision(existing.event.status)) {
      return NextResponse.json({ error: DECISION_CLOSED_MESSAGE }, { status: 400 });
    }

    const { decision } = decideSuggestionSchema.parse(await req.json());
    const pending = await prisma.equipmentSuggestion.findFirst({
      where: { requestId, status: "pending" },
      select: { id: true, equipmentId: true, quantity: true },
    });
    if (!pending) {
      return NextResponse.json({ error: "There is no suggestion waiting for a decision on this item." }, { status: 400 });
    }
    if (decision === "accept") {
      const refusal = checkAcceptance(existing.status);
      if (refusal) return NextResponse.json({ error: refusal }, { status: 400 });
    }

    const outcome = decision === "accept" ? "accepted" : "declined";
    await prisma.$transaction(async (tx) => {
      // Only if it is still pending: a decision made in another tab a moment
      // ago must not be applied twice.
      const { count } = await tx.equipmentSuggestion.updateMany({
        where: { id: pending.id, status: "pending" },
        data: { status: outcome, decidedBy: actor.id, decidedAt: new Date() },
      });
      if (count === 0) throw new RouteError(409, "This suggestion has already been decided — refresh the page.");
      if (decision === "decline") return;

      const plan = acceptChanges(existing, pending);
      await tx.equipmentRequest.update({ where: { id: requestId }, data: plan.update });
      if (plan.add) {
        await tx.equipmentRequest.create({
          data: {
            eventId: existing.eventId,
            sessionId: existing.sessionId,
            equipmentId: plan.add.equipmentId,
            quantityRequested: plan.add.quantityRequested,
            technicalRequirements: existing.technicalRequirements,
            startsAt: existing.startsAt,
            endsAt: existing.endsAt,
            requestedBy: actor.id,
            status: "requested",
          },
        });
      }
    });
    return NextResponse.json({ decision: outcome });
  } catch (err) {
    // The event requested the alternative itself since it was suggested.
    if (err instanceof Error && err.message.includes(UNIQUE_VIOLATION)) {
      return NextResponse.json(
        { error: "This item is already requested for this event — update the existing row instead" },
        { status: 400 }
      );
    }
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  if (err instanceof RouteError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/// Thrown inside the transaction to carry an HTTP status back out - Prisma
/// rolls the transaction back on any thrown error, so a refusal writes nothing.
class RouteError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
