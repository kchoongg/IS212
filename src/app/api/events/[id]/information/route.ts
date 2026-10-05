import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { parseEventReference } from "@/lib/format";
import { EVENT_INFORMATION_STATUSES, canUpdateEventInformation, canViewEvent } from "@/lib/permissions";
import { updateEventInformationSchema, type UpdateEventInformationInput } from "@/lib/validation";
import { applyEventInformation, mergedEventInfo, type EventForChange } from "@/lib/applyEventInformation";

// Update Event Information (SPM-62): the assigned coordinator changes an
// event's permitted information after approval. The rules for what a change
// affects are src/lib/eventChangeImpact.ts; applying it is
// src/lib/applyEventInformation.ts, shared with Process Event Change Request
// (SPM-32). Separate from PATCH /api/events/[id], which edits a DRAFT for its
// organiser (SPM-24) - a different person, a different status and different
// consequences.

/// Fields a multi-session event takes from its sessions (deriveEventFromSessions).
/// Editing them here would change the event without its sessions; editing the
/// sessions is a follow-up story.
const SESSION_DERIVED = ["startsAt", "endsAt", "expectedAttendance", "preferredLayout"] as const;

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
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
            include: { facilityRequirements: { select: { facilityId: true } }, sessions: { select: { id: true } } },
          });
    // An event the user may not see is 404, never 403 - a 403 would confirm it exists.
    if (!event || !canViewEvent(actor, event)) {
      return hidden();
    }
    if (!canUpdateEventInformation(actor, event)) {
      return forbidden("Only the coordinator assigned to this event can change its information");
    }
    if (!EVENT_INFORMATION_STATUSES.includes(event.status)) {
      return NextResponse.json(
        { error: "Event information can only be changed while the event is Approved, Planning or Confirmed." },
        { status: 400 }
      );
    }

    const data = updateEventInformationSchema.parse(await req.json());

    if (event.sessions.length > 0 && SESSION_DERIVED.some((field) => data[field] !== undefined)) {
      return NextResponse.json({ error: "Session times and attendance can't be changed here yet." }, { status: 400 });
    }

    const fieldErrors = crossFieldErrors(event, data);
    const firstField = Object.keys(fieldErrors)[0];
    if (firstField) {
      // Keyed by field so readServerError() (src/lib/formErrors.ts) shows each
      // message under its own field, as the draft edit does.
      return NextResponse.json(
        {
          error: fieldErrors[firstField],
          details: { fieldErrors: Object.fromEntries(Object.entries(fieldErrors).map(([f, m]) => [f, [m]])) },
        },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction((tx: Prisma.TransactionClient) =>
      applyEventInformation(tx, event as EventForChange, data, actor.id)
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/// Rules that need the saved record as well as the payload: changing only the
/// end still has to make sense against the start already saved.
function crossFieldErrors(
  event: EventForChange & { registrationOpensAt: Date | null; registrationClosesAt: Date | null },
  data: UpdateEventInformationInput
): Record<string, string> {
  const { startsAt, endsAt } = mergedEventInfo(event, data);
  const errors: Record<string, string> = {};
  if (startsAt && endsAt && endsAt <= startsAt) {
    errors.endsAt = "Ends at must be after starts at.";
  }
  // The registration period is Configure Event Registration's (SPM-64), whose
  // rule is that it closes no later than the event starts. Moving the start
  // earlier must not break it from this side.
  if (data.startsAt !== undefined && startsAt) {
    const closes = event.registrationClosesAt;
    const opens = event.registrationOpensAt;
    if ((closes && closes > startsAt) || (opens && opens >= startsAt)) {
      errors.startsAt = "Registration closes after this start time. Change the registration period first.";
    }
  }
  return errors;
}
