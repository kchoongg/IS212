import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import {
  canEditEventContent,
  canSetEventStatus,
  canViewEvent,
  visibleEventFor,
  type Actor,
} from "@/lib/permissions";
import { updateEventStatusSchema, updateEventDraftSchema } from "@/lib/validation";
import { ZodError } from "zod";
import type { Prisma } from "@prisma/client";

// ADDED: equipment is held wider than the event itself - kept in sync with
// the same window POST /api/events uses, so editing a draft's dates moves
// its equipment reservation window the same way creating it does.
const LOAD_WINDOW_MS = 2 * 60 * 60 * 1000;

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      facilityRequirements: { include: { facility: true } },
      // ADDED: the hub's "Event at a glance" sidebar (S-06, design/mockups/
      // OrganiserEventDetail.dc.html) names the coordinator.
      coordinator: { select: { fullName: true } },
      equipmentRequests: true,
    },
  });
  if (!event) {
    return hidden();
  }

  // CHANGED: was a draft-ownership check only. canViewEvent() now applies the
  // whole of briefing §8b - a draft stays private to its organiser, an
  // organiser sees only their own client's events, and an attendee sees an
  // event only once it is confirmed and open for registration. An event the
  // user may not see is 404, not 403: a 403 would confirm it exists.
  if (!canViewEvent(actor, event)) {
    return hidden();
  }

  // ADDED: and even a visible event is not visible in full. An attendee gets
  // the public subset; the rejection reason, the assigned coordinator, the
  // client's special requirements and the venue and equipment arrangements
  // are internal planning information (briefing §8b).
  return NextResponse.json(visibleEventFor(actor, event));
}

/**
 * Two different edits share this endpoint, told apart by the body shape:
 *   - `{ status, reason? }` moves the event through the BPMN status
 *     lifecycle (see docs/ConnectSphere_Status_Lifecycle.drawio) - open to
 *     whichever role owns that transition in the briefing's §5 process, and
 *     only to a user related to the event. See STATUS_TRANSITION_ROLES in
 *     src/lib/permissions.ts and docs/PERMISSIONS.md.
 *   - anything else (SPM-24) edits a draft's own content - title, schedule,
 *     requirements, etc. - and is restricted to the organiser who owns it,
 *     while the event is still a draft. Once submitted, changes go through
 *     EventChangeRequest instead (see schema.prisma), not this endpoint.
 */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    const body = await req.json();

    const event = await prisma.event.findUnique({ where: { id } });
    if (!event) {
      return hidden();
    }

    // ADDED: an event the user cannot see cannot be reached through PATCH
    // either. Without this, an id guessed from a 404 could still be written
    // to - the read and the write have to answer the same question.
    if (!canViewEvent(actor, event)) {
      return hidden();
    }

    // `await` here matters: `return handleDraftEdit(...)` without it lets a
    // rejection (e.g. the ZodError from .parse()) escape as an unhandled
    // promise rejection instead of landing in the catch below, since the
    // `return` completes this try block before the inner promise settles.
    if (body && typeof body === "object" && "status" in body) {
      return await handleStatusChange(id, actor, event, body);
    }
    return await handleDraftEdit(id, actor, event, body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function handleStatusChange(
  id: string,
  actor: Actor,
  event: NonNullable<Awaited<ReturnType<typeof prisma.event.findUnique>>>,
  body: unknown
) {
  const data = updateEventStatusSchema.parse(body);

  // CHANGED: was an ownership check on drafts only, which left every
  // transition past draft open to anyone signed in - an attendee could
  // confirm or reject an event. canSetEventStatus() applies the briefing's
  // §5 process instead: the organiser submits their own request, the Ops
  // Manager assigns it, and the coordinator responsible for it approves,
  // rejects, confirms and completes it. Visibility was already checked by the
  // caller, so a refusal here is an honest 403.
  if (!canSetEventStatus(actor, event, data.status)) {
    return forbidden(`Your role cannot move an event to "${data.status}"`);
  }

  // ADDED: a draft may be incomplete, but anything past draft may not.
  // The SQL design enforced this with a CHECK constraint; Prisma has no
  // equivalent, so the rule moves here - the one place status leaves draft.
  if (event.status === "draft" && data.status !== "draft") {
    const missing: string[] = [];
    if (!event.title) missing.push("title");
    if (!event.category) missing.push("category");
    if (!event.startsAt) missing.push("startsAt");
    if (!event.endsAt) missing.push("endsAt");
    if (event.expectedAttendance == null) missing.push("expectedAttendance");
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Cannot submit an incomplete event. Missing: ${missing.join(", ")}` },
        { status: 400 }
      );
    }
  }

  // ADDED: the brief requires a rejected request to retain the decision reason.
  if (data.status === "rejected" && !data.reason?.trim()) {
    return NextResponse.json(
      { error: "A reason is required when rejecting an event" },
      { status: 400 }
    );
  }

  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const e = await tx.event.update({
      where: { id },
      data: {
        status: data.status,
        // Keep the decision record on the event itself as well as in history.
        ...(data.status === "rejected" ? { rejectionReason: data.reason } : {}),
        ...(data.status === "cancelled" ? { cancellationReason: data.reason } : {}),
        ...(data.status === "submitted" ? { submittedAt: new Date() } : {}),
        ...(data.status === "confirmed" ? { confirmedAt: new Date() } : {}),
      },
    });
    await tx.eventStatusHistory.create({
      data: {
        eventId: id,
        // CHANGED: oldStatus -> fromStatus, newStatus -> toStatus.
        fromStatus: event.status,
        toStatus: data.status,
        changedBy: actor.id,
        reason: data.reason,
      },
    });
    return e;
  });

  return NextResponse.json(updated);
}

/**
 * SPM-24: save changes to a draft's own fields. Restricted to the owning
 * organiser and to drafts - AC "a draft is not treated as a submitted event
 * request" means this must not become a back door for editing a request
 * that has already left the organiser's hands.
 */
async function handleDraftEdit(
  id: string,
  actor: Actor,
  event: NonNullable<Awaited<ReturnType<typeof prisma.event.findUnique>>>,
  body: unknown
) {
  // Only the owning organiser edits a draft's content. A draft belonging to
  // someone else was already hidden as a 404 by the caller, so the remaining
  // refusals are honest: the wrong role, or an event that has left draft.
  if (event.status !== "draft") {
    return NextResponse.json({ error: "Only draft requests can be edited" }, { status: 400 });
  }
  if (!canEditEventContent(actor, event)) {
    return forbidden("Only the organiser who owns this draft can edit it");
  }

  const data = updateEventDraftSchema.parse(body);

  // Cross-field rules have to run against the merged record, not just this
  // payload - editing only `endsAt` still has to make sense against whatever
  // `startsAt` was saved earlier.
  const startsAt = data.startsAt !== undefined ? new Date(data.startsAt) : event.startsAt;
  const endsAt = data.endsAt !== undefined ? new Date(data.endsAt) : event.endsAt;
  const registrationEnabled =
    data.registrationEnabled !== undefined ? data.registrationEnabled : event.registrationEnabled;
  const registrationCapacity =
    data.registrationCapacity !== undefined ? data.registrationCapacity : event.registrationCapacity;
  const registrationOpensAt =
    data.registrationOpensAt !== undefined ? new Date(data.registrationOpensAt) : event.registrationOpensAt;
  const registrationClosesAt =
    data.registrationClosesAt !== undefined ? new Date(data.registrationClosesAt) : event.registrationClosesAt;

  const errors: string[] = [];
  if (startsAt && endsAt && endsAt <= startsAt) {
    errors.push("endsAt must be after startsAt");
  }
  if (registrationEnabled && registrationCapacity == null) {
    errors.push("registrationCapacity is required when registrationEnabled is true");
  }
  if (registrationOpensAt && registrationClosesAt && registrationClosesAt <= registrationOpensAt) {
    errors.push("registrationClosesAt must be after registrationOpensAt");
  }
  if (registrationOpensAt && startsAt && registrationOpensAt >= startsAt) {
    errors.push("registrationOpensAt must be before the event starts");
  }
  if (registrationClosesAt && startsAt && registrationClosesAt >= startsAt) {
    errors.push("registrationClosesAt must be before the event starts");
  }
  if (data.equipment?.length && (!startsAt || !endsAt)) {
    errors.push("Set the event date and time before requesting equipment");
  }
  if (errors.length > 0) {
    return NextResponse.json({ error: errors[0] }, { status: 400 });
  }

  // Equipment is held wider than the event, same as on create.
  const equipmentStartsAt = startsAt ? new Date(startsAt.getTime() - LOAD_WINDOW_MS) : null;
  const equipmentEndsAt = endsAt ? new Date(endsAt.getTime() + LOAD_WINDOW_MS) : null;

  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // A field that's being replaced is cleared first and rebuilt from the
    // payload below - simpler than diffing rows against what's already there.
    if (data.facilityIds !== undefined) {
      await tx.eventFacilityRequirement.deleteMany({ where: { eventId: id } });
    }
    if (data.equipment !== undefined) {
      await tx.equipmentRequest.deleteMany({ where: { eventId: id } });
    }

    return tx.event.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.purpose !== undefined ? { purpose: data.purpose } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.startsAt !== undefined ? { startsAt } : {}),
        ...(data.endsAt !== undefined ? { endsAt } : {}),
        ...(data.expectedAttendance !== undefined ? { expectedAttendance: data.expectedAttendance } : {}),
        ...(data.preferredLayout !== undefined ? { preferredLayout: data.preferredLayout } : {}),
        ...(data.accessibilityNotes !== undefined ? { accessibilityNotes: data.accessibilityNotes } : {}),
        ...(data.specialRequirements !== undefined ? { specialRequirements: data.specialRequirements } : {}),
        ...(data.registrationEnabled !== undefined ? { registrationEnabled: data.registrationEnabled } : {}),
        ...(data.registrationCapacity !== undefined ? { registrationCapacity: data.registrationCapacity } : {}),
        ...(data.registrationOpensAt !== undefined ? { registrationOpensAt } : {}),
        ...(data.registrationClosesAt !== undefined ? { registrationClosesAt } : {}),
        facilityRequirements: data.facilityIds?.length
          ? { create: data.facilityIds.map((facilityId) => ({ facilityId, isMandatory: true })) }
          : undefined,
        equipmentRequests:
          data.equipment?.length && equipmentStartsAt && equipmentEndsAt
            ? {
                create: data.equipment.map((item) => ({
                  equipmentId: item.equipmentId,
                  quantityRequested: item.quantityRequested,
                  technicalRequirements: item.technicalRequirements,
                  startsAt: equipmentStartsAt,
                  endsAt: equipmentEndsAt,
                  requestedBy: actor.id,
                  status: "requested",
                })),
              }
            : undefined,
      },
      include: {
        facilityRequirements: { select: { facilityId: true, isMandatory: true } },
        equipmentRequests: {
          select: {
            id: true,
            equipmentId: true,
            quantityRequested: true,
            technicalRequirements: true,
            status: true,
          },
        },
      },
    });
  });

  return NextResponse.json(updated);
}
