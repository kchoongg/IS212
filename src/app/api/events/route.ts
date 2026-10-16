import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { can, eventListWhere, visibleEventsFor } from "@/lib/permissions";
import { SEAT_TAKING, registrationState } from "@/lib/registrationEligibility";
import { createEventSchema } from "@/lib/validation";
import { deriveEventFromSessions, equipmentWindow } from "@/lib/eventSessions";
import { writeSessions, SESSION_SELECT } from "@/lib/sessionWrites";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }

  // CHANGED: the scoping rule moved to src/lib/permissions.ts, where it is
  // unit tested and stated once. It now covers the whole of briefing §8b, not
  // just drafts: an organiser sees their own events plus their client
  // organisation's submitted ones (never a colleague's private draft), an
  // attendee sees only confirmed events open for registration, and internal
  // staff see everything except drafts.
  const isAttendee = actor.role === "attendee";
  const events = await prisma.event.findMany({
    where: eventListWhere(actor),
    orderBy: { createdAt: "desc" },
    include: {
      facilityRequirements: { include: { facility: true } },
      // SPM-51 (Browse Events): which company is running each event.
      ...(isAttendee ? { organisation: { select: { name: true } } } : {}),
    },
  });

  // SPM-51 AC1: an attendee is told, per event, whether they can register.
  // The seats taken are counted for every event in one query.
  if (isAttendee) {
    const counts = await prisma.registration.groupBy({
      by: ["eventId"],
      where: { eventId: { in: events.map((e) => e.id) }, status: { in: SEAT_TAKING } },
      _count: { _all: true },
    });
    const taken = new Map(counts.map((c) => [c.eventId, c._count._all]));
    const now = new Date();
    const withState = events.map((e) => ({ ...e, registrationState: registrationState(e, taken.get(e.id) ?? 0, now) }));
    return NextResponse.json(visibleEventsFor(actor, withState));
  }

  // An attendee gets the public subset of each event, not the whole record.
  return NextResponse.json(visibleEventsFor(actor, events));
}

export async function POST(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    // ADDED: raising an event request is the Event Organiser's job (briefing
    // §5 Step 1). Nobody else may create one on their own behalf.
    if (!can(actor.role, "event:create")) {
      return forbidden("Only an Event Organiser can raise an event request");
    }

    const body = await req.json();
    const data = createEventSchema.parse(body);

    // ADDED (multi-session events, class clarification #74): an event split
    // into sessions takes its own start, end and headcount from them - the
    // Event row keeps those columns so every event list keeps working, but
    // they are derived, never taken from the request body alongside sessions.
    const derived = deriveEventFromSessions(data.sessions);
    const startsAt = derived?.startsAt ?? (data.startsAt ? new Date(data.startsAt) : null);
    const endsAt = derived?.endsAt ?? (data.endsAt ? new Date(data.endsAt) : null);
    const expectedAttendance = derived?.expectedAttendance ?? data.expectedAttendance;

    // ADDED: equipment is held wider than the event itself — kit leaves the
    // store before the doors open and comes back after they close. Technical
    // Support adjusts the window when they review the request.
    const equipmentTimes = startsAt && endsAt ? equipmentWindow(startsAt, endsAt) : null;

    // ADDED (SPM-48): refuse retired equipment here too, not only in the picker.
    if (data.equipment?.length) {
      const retired = await prisma.equipment.findFirst({
        where: { id: { in: data.equipment.map((item) => item.equipmentId) }, isActive: false },
        select: { name: true },
      });
      if (retired) {
        return NextResponse.json(
          { error: `${retired.name} has been retired and can no longer be requested` },
          { status: 400 }
        );
      }
    }

    // The event and its requirements are one thing to the organiser, so they
    // are one transaction here: a half-written request with facilities but no
    // equipment - or sessions but no event - would be worse than a failure they
    // can retry.
    const event = await prisma.$transaction(
      async (tx) => {
        const created = await tx.event.create({
          data: {
            organiserId: actor.id,
            // An event belongs to a client organisation, which is how access is
            // scoped ("an Organiser should not see events of unrelated clients").
            // It comes from the signed-in user, never from the request body.
            organisationId: actor.organisationId,
            title: data.title,
            category: data.category,
            purpose: data.purpose,
            description: data.description,
            // CHANGED: proposedDate + timeSlot -> real startsAt / endsAt timestamps.
            startsAt: startsAt ?? undefined,
            endsAt: endsAt ?? undefined,
            expectedAttendance,
            preferredLayout: data.preferredLayout,
            // CHANGED: accessibilityNeeds -> accessibilityNotes.
            accessibilityNotes: data.accessibilityNotes,
            specialRequirements: data.specialRequirements,
            registrationEnabled: data.registrationEnabled ?? false,
            registrationCapacity: data.registrationCapacity,
            registrationOpensAt: data.registrationOpensAt ? new Date(data.registrationOpensAt) : undefined,
            registrationClosesAt: data.registrationClosesAt ? new Date(data.registrationClosesAt) : undefined,
            status: "draft",

            // Stored as rows, not prose, so venue suitability can match them.
            // Everything an organiser ticks is mandatory; the nice-to-have case
            // (isMandatory: false) is a coordinator refinement, not an organiser
            // one, so it is not exposed on this form.
            facilityRequirements: data.facilityIds?.length
              ? {
                  create: data.facilityIds.map((facilityId) => ({
                    facilityId,
                    isMandatory: true,
                  })),
                }
              : undefined,

            // Guarded by createEventSchema: equipment cannot be requested without
            // event dates, so these are non-null whenever the array is set. These
            // are the event-wide requests (sessionId null); each session's own
            // equipment is written by writeSessions below.
            equipmentRequests:
              data.equipment?.length && equipmentTimes
                ? {
                    create: data.equipment.map((item) => ({
                      equipmentId: item.equipmentId,
                      quantityRequested: item.quantityRequested,
                      technicalRequirements: item.technicalRequirements,
                      startsAt: equipmentTimes.startsAt,
                      endsAt: equipmentTimes.endsAt,
                      requestedBy: actor.id,
                      status: "requested",
                    })),
                  }
                : undefined,
          },
        });

        if (data.sessions?.length) {
          await writeSessions(tx, created.id, actor.id, data.sessions);
        }

        return tx.event.findUniqueOrThrow({
          where: { id: created.id },
          include: {
            facilityRequirements: { select: { facilityId: true, isMandatory: true } },
            equipmentRequests: {
              select: { id: true, equipmentId: true, quantityRequested: true, status: true, sessionId: true },
            },
            sessions: { select: SESSION_SELECT, orderBy: { startsAt: "asc" } },
          },
        });
      },
      // Interactive transactions default to 5s; a cold Neon start plus a
      // several-session event can run past that.
      { timeout: 15000 }
    );

    return NextResponse.json(event, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    // The (eventId, equipmentId) unique index - the same item in two places on
    // one event. Zod catches this first; this is the backstop, so a race or a
    // future path around the schema still gets a message rather than a 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "Each item can only be requested once per event, across all sessions." },
        { status: 400 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
