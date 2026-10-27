import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { parseEventReference } from "@/lib/format";
import { canRequestEventChange, canViewChangeRequests } from "@/lib/permissions";
import { createChangeRequestSchema } from "@/lib/validation";
import {
  CHANGE_REQUEST_OWNER_MESSAGE,
  CHANGE_REQUEST_STATUS_MESSAGE,
  NOTHING_CHANGED,
  SESSIONS_FIXED,
  SESSION_DERIVED_FIELDS,
  canRequestChangeIn,
  describeChangeRequest,
  fieldChanges,
  importantFor,
  snapshotOf,
} from "@/lib/eventChangeRequest";
import { canViewEventWithHistory } from "@/lib/eventVisibility";

// Request Event Change (SPM-35): the organiser who owns an event asks for a
// change to it, and the event's people see what was asked. The rules are
// src/lib/eventChangeRequest.ts.
//
// A request is only recorded. The event, its status and its arrangements stay
// exactly as they are (AC5, AC6) until the assigned coordinator processes it -
// Process Event Change Request (SPM-32), Postpone Event, Cancel Event. Telling
// the coordinator is Receive Event Notifications (SPM-53).

const EVENT_INCLUDE = {
  facilityRequirements: { select: { facilityId: true, facility: { select: { name: true } } } },
  sessions: { select: { id: true } },
} as const;

const REQUESTER = { requester: { select: { fullName: true } } } as const;

async function loadEvent(id: string) {
  const sequenceNumber = parseEventReference(id);
  return sequenceNumber === null ? null : prisma.event.findUnique({ where: { sequenceNumber }, include: EVENT_INCLUDE });
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    const event = await loadEvent(id);
    // An event the user may not see is 404, never 403 - a 403 would confirm it exists.
    if (!event || !(await canViewEventWithHistory(actor, event))) {
      return hidden();
    }
    if (!canRequestEventChange(actor, event)) {
      return forbidden(CHANGE_REQUEST_OWNER_MESSAGE);
    }
    if (!canRequestChangeIn(event.status)) {
      return NextResponse.json({ error: CHANGE_REQUEST_STATUS_MESSAGE }, { status: 400 });
    }

    const data = createChangeRequestSchema.parse(await req.json());
    const base = { eventId: event.id, requestedBy: actor.id, kind: data.kind, reason: data.reason };

    // AC5: a request to postpone or cancel is a reason and nothing else.
    if (data.kind !== "change") {
      const created = await prisma.eventChangeRequest.create({
        data: { ...base, equipmentChanges: null, isSignificant: false, status: "pending" },
        include: REQUESTER,
      });
      return NextResponse.json(describeChangeRequest(created, snapshotOf(event)), { status: 201 });
    }

    const proposal = data.changes ?? {};
    if (event.sessions.length > 0 && SESSION_DERIVED_FIELDS.some((field) => proposal[field] !== undefined)) {
      return NextResponse.json({ error: SESSIONS_FIXED }, { status: 400 });
    }

    const facilityNames = new Map<string, string>();
    const proposedFacilities = [...new Set(proposal.facilityIds ?? [])];
    if (proposedFacilities.length > 0) {
      const found = await prisma.facility.findMany({
        where: { id: { in: proposedFacilities } },
        select: { id: true, name: true },
      });
      if (found.length !== proposedFacilities.length) {
        return NextResponse.json({ error: "Choose facilities from the list." }, { status: 400 });
      }
      for (const facility of found) facilityNames.set(facility.id, facility.name);
    }

    const current = snapshotOf(event);
    const changes = fieldChanges(current, proposal, facilityNames);
    const equipmentChanges = data.equipmentChanges?.trim() || null;
    if (changes.length === 0 && !equipmentChanges) {
      return NextResponse.json({ error: NOTHING_CHANGED }, { status: 400 });
    }

    // The new end against the new start, or the start already saved.
    const startsAt = proposal.startsAt ? new Date(proposal.startsAt) : event.startsAt;
    const endsAt = proposal.endsAt ? new Date(proposal.endsAt) : event.endsAt;
    if (startsAt && endsAt && endsAt <= startsAt) {
      const message = "Ends at must be after starts at.";
      return NextResponse.json({ error: message, details: { fieldErrors: { endsAt: [message] } } }, { status: 400 });
    }

    const created = await prisma.eventChangeRequest.create({
      data: {
        ...base,
        changes: changes as unknown as Prisma.InputJsonValue,
        equipmentChanges,
        // AC4: Important - the date and time, attendance, venue requirements or equipment.
        isSignificant: importantFor(changes, equipmentChanges).length > 0,
        status: "pending",
      },
      include: REQUESTER,
    });
    return NextResponse.json(describeChangeRequest(created, current), { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    const event = await loadEvent(id);
    if (!event || !(await canViewEventWithHistory(actor, event))) {
      return hidden();
    }
    if (!canViewChangeRequests(actor, event)) {
      return forbidden("Change requests are for the event's organisers, its coordinator and the Ops Manager.");
    }

    const rows = await prisma.eventChangeRequest.findMany({
      where: { eventId: event.id },
      orderBy: { requestedAt: "desc" },
      include: REQUESTER,
    });
    const current = snapshotOf(event);
    return NextResponse.json(rows.map((row) => describeChangeRequest(row, current)));
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
