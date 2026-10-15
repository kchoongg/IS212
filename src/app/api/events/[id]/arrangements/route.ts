import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { parseEventReference } from "@/lib/format";
import {
  ARRANGEMENT_MARKING_STATUSES,
  canMarkArrangements,
  canViewArrangements,
  canViewEvent,
  type Actor,
} from "@/lib/permissions";
import { markArrangementSchema } from "@/lib/validation";
import { isTerminalEventStatus } from "@/lib/statuses";
import { arrangementsFor, blockingArrangements } from "@/lib/eventConfirmation";
import { loadConfirmationInput } from "@/lib/eventArrangements";

// SPM-33, Track Outstanding Arrangements. GET is the event's Readiness list:
// every venue booking, equipment line and (where enabled) the registration
// setup, each complete, outstanding or marked as not required. PATCH marks one
// of them as not required, or as required again.
//
// The list is arrangementsFor() (src/lib/eventConfirmation.ts) - the same rows
// Confirm refuses on - so nothing here decides what is outstanding.

const ONLY_ASSIGNED = "Only the assigned Coordinator can mark an arrangement as not required.";
const ONLY_IN_PLANNING = "Arrangements can only be marked as not required while the event is in Planning.";
const ONLY_OUTSTANDING = "Only an outstanding arrangement can be marked as not required.";
const NOT_ON_EVENT = "This arrangement is not part of this event.";

async function loadEvent(reference: string) {
  const sequenceNumber = parseEventReference(reference);
  if (sequenceNumber === null) return null;
  return prisma.event.findUnique({
    where: { sequenceNumber },
    include: { registrationNotRequiredByUser: { select: { fullName: true } } },
  });
}

type LoadedEvent = NonNullable<Awaited<ReturnType<typeof loadEvent>>>;

/// What the Readiness tab shows, and what PATCH answers with after a change.
async function readiness(actor: Actor, event: LoadedEvent) {
  const arrangements = arrangementsFor(await loadConfirmationInput(event));
  return {
    event: { sequenceNumber: event.sequenceNumber, title: event.title, status: event.status },
    // Whether to offer the buttons: the same two checks PATCH makes.
    canManage: canMarkArrangements(actor, event) && ARRANGEMENT_MARKING_STATUSES.includes(event.status),
    // SPM-68: whether a flagged arrangement can be kept from this list and
    // pointed at the Flagged Arrangements page, which lists it for the
    // assigned coordinator alone - at any status of an event still going
    // ahead, unlike marking above. Not once the event is over or called off:
    // that page no longer lists it.
    canReviewFlags: canMarkArrangements(actor, event) && !isTerminalEventStatus(event.status),
    blocking: blockingArrangements(arrangements).length,
    arrangements,
  };
}

function serverError(err: unknown) {
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    if (!canViewArrangements(actor)) {
      return forbidden("Event readiness is for Event Coordinators");
    }
    const event = await loadEvent(id);
    if (!event || !canViewEvent(actor, event)) {
      return hidden();
    }

    return NextResponse.json(await readiness(actor, event));
  } catch (err) {
    return serverError(err);
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    const event = await loadEvent(id);
    if (!event || !canViewEvent(actor, event)) {
      return hidden();
    }
    if (!canMarkArrangements(actor, event)) {
      return forbidden(ONLY_ASSIGNED);
    }

    const data = markArrangementSchema.parse(await req.json());

    if (!ARRANGEMENT_MARKING_STATUSES.includes(event.status)) {
      return NextResponse.json({ error: ONLY_IN_PLANNING }, { status: 400 });
    }

    // Found in the list the coordinator was shown, so an id from another
    // event, or a request that is not an arrangement (rejected, cancelled),
    // is simply not there.
    const arrangements = arrangementsFor(await loadConfirmationInput(event));
    const target =
      data.kind === "registration"
        ? arrangements.find((a) => a.kind === "registration")
        : arrangements.find((a) => a.kind === data.kind && a.id === data.id);

    if (!target && data.kind !== "registration") {
      return NextResponse.json({ error: NOT_ON_EVENT }, { status: 404 });
    }
    // Registration that is not enabled has no setup to waive: nothing is
    // outstanding, which is the honest refusal.
    if (data.notRequired && !target?.waivable) {
      return NextResponse.json({ error: ONLY_OUTSTANDING }, { status: 400 });
    }

    // Reversing a decision that was never made changes nothing, and must not
    // stamp the record as though it had.
    if (data.notRequired || target?.waived) {
      // Who decided, and when - on marking and on reversing (briefing 8f,
      // customer answer #14). The arrangement itself is not touched.
      const by = actor.id;
      const at = new Date();
      if (data.kind === "venue") {
        await prisma.venueBooking.update({
          where: { id: data.id },
          data: { notRequired: data.notRequired, notRequiredBy: by, notRequiredAt: at },
        });
      } else if (data.kind === "equipment") {
        await prisma.equipmentRequest.update({
          where: { id: data.id },
          data: { notRequired: data.notRequired, notRequiredBy: by, notRequiredAt: at },
        });
      } else {
        await prisma.event.update({
          where: { id: event.id },
          data: {
            registrationNotRequired: data.notRequired,
            registrationNotRequiredBy: by,
            registrationNotRequiredAt: at,
          },
        });
      }
    }

    // Read again, so the answer is what is now stored.
    const fresh = await loadEvent(id);
    if (!fresh) {
      return hidden();
    }
    return NextResponse.json(await readiness(actor, fresh));
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    return serverError(err);
  }
}
