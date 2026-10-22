import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { expireDueHolds } from "@/lib/holdExpiryService";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { eventReference, parseEventReference } from "@/lib/format";
import {
  REVIEWABLE_STATUSES,
  REVIEW_OUTCOMES,
  can,
  canEditEventContent,
  canSeeClarification,
  canSetEventStatus,
  canViewEvent,
  canViewRegistrationList,
  visibleEventFor,
  type Actor,
} from "@/lib/permissions";
import { decodeFields } from "@/lib/clarification";
import { updateEventStatusSchema, updateEventDraftSchema } from "@/lib/validation";
import { notifyRole } from "@/lib/notifications";
import {
  CHANGE_REQUEST_CLOSED_NOTE,
  SAFETY_CHECK_CLOSED_NOTE,
  arrangementCancellationNote,
} from "@/lib/eventCancellation";
import { releaseNotification } from "@/lib/venueBookingChange";
import { closeSafetyCheck } from "@/lib/safetyCheckClose";
import { isExternalRole } from "@/lib/roles";
import { dayIndex, dayStart } from "@/lib/equipmentAvailability";
import { canTransition, transitionError } from "@/lib/statuses";
import { checkEventConfirmation } from "@/lib/eventConfirmation";
import { loadConfirmationInput } from "@/lib/eventArrangements";
import { HOLDING_A_PLACE } from "@/lib/registrationSettings";
import { SEAT_TAKING, registrationCounts, registrationState } from "@/lib/registrationEligibility";
import { deriveEventFromSessions, equipmentWindow } from "@/lib/eventSessions";
import { writeSessions, SESSION_SELECT } from "@/lib/sessionWrites";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }

  // CHANGED (SPM-31): the route segment is now the user-facing reference
  // (e.g. "EVT-000123"), not the underlying UUID - see eventReference() /
  // parseEventReference() in src/lib/format.ts. A segment that doesn't parse
  // gets the same refusal as one that parses but matches nothing.
  const sequenceNumber = parseEventReference(id);
  const event =
    sequenceNumber === null
      ? null
      : await prisma.event.findUnique({
          where: { sequenceNumber },
          include: {
            facilityRequirements: { include: { facility: true } },
            // ADDED (SPM-47): the hub's "Event at a glance" sidebar (S-06,
            // design/mockups/OrganiserEventDetail.dc.html) names the coordinator.
            coordinator: { select: { fullName: true } },
            // ADDED (SPM-31): the Overview tab names who raised the request,
            // symmetric to the coordinator above. Stripped for an Attendee by
            // visibleEventFor() (ATTENDEE_EVENT_FIELDS omits "organiser").
            organiser: { select: { fullName: true } },
            // ADDED (SPM-31): the event's OWN organisation relation, not
            // organiser.organisation - kept separate so an Attendee can be shown
            // which company is running the event (ATTENDEE_EVENT_FIELDS includes
            // "organisation") without exposing the organiser's personal name.
            organisation: { select: { name: true } },
            // Each row carries its sessionId (null = the whole event), which is how
            // the edit form tells event-wide equipment from a session's own.
            // CHANGED (SPM-28): with the item's name, so the review page can
            // list what was requested. Additive - toFormValues() maps the
            // columns it needs and ignores the rest.
            equipmentRequests: { include: { equipment: { select: { name: true } } } },
            // ADDED (SPM-34 AC6/AC7): the room that was actually booked, so
            // the organiser can see the arrangement rather than only that the
            // event is Confirmed. Approved bookings only - a pending request
            // is not an arrangement anyone should be shown as settled.
            // Stripped for an Attendee by visibleEventFor(), which allow-lists
            // fields and so drops this one without needing to name it.
            // CHANGED (SPM-85 AC3): with the layout booked and the seats each of
            // the room's layouts holds, so a safety review can read the
            // capacity of the arrangement actually made.
            venueBookings: {
              where: { status: "approved" },
              select: {
                startsAt: true,
                endsAt: true,
                layoutName: true,
                // SPM-90 (AC5): what each booked space is for.
                purpose: true,
                session: { select: { label: true } },
                // SPM-87 (AC2): with id and opening hours, and - added below -
                // its unavailable periods on the event's dates.
                venue: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    opensAt: true,
                    closesAt: true,
                    layouts: { select: { layoutName: true, capacity: true } },
                  },
                },
              },
              orderBy: { startsAt: "asc" },
            },
            // ADDED (SPM-23, multi-session events): empty for an ordinary
            // single-session event. SESSION_SELECT (src/lib/sessionWrites.ts) is a
            // superset of what SPM-47's per-session equipment picker needs
            // (id/label/startsAt/endsAt), so it's reused here rather than
            // duplicating a second, narrower select shape.
            sessions: { select: SESSION_SELECT, orderBy: { startsAt: "asc" } },
            // ADDED (SPM-64 AC4): the booking the registration capacity is
            // measured against, so the Registration card can name it and say
            // when it is no longer active. Stripped for an Attendee by
            // visibleEventFor() - which room caps the capacity is internal.
            registrationVenueBooking: {
              select: {
                id: true,
                status: true,
                layoutName: true,
                venue: { select: { name: true, code: true, layouts: { select: { layoutName: true, capacity: true } } } },
              },
            },
            // ADDED (SPM-86 AC8): the latest Operational Safety Check - who
            // submitted it and when. Reshaped to `safetyCheck` below, for
            // internal users only.
            // CHANGED (SPM-88 AC1): every check, newest first, as
            // `safetyHistory`; the latest is still `safetyCheck`.
            safetyChecks: {
              orderBy: { submittedAt: "desc" },
              select: {
                status: true,
                submittedAt: true,
                submitter: { select: { fullName: true } },
                // SPM-87 (AC10): the Safety Officer's decision, who and when.
                decidedAt: true,
                decider: { select: { fullName: true } },
                decisionNote: true,
              },
            },
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
  // SPM-64 (#10): an attendee who holds a place keeps seeing the event once
  // its registration is turned off. Counted only for an attendee.
  const attendeeHoldsPlace =
    actor.role === "attendee" &&
    (await prisma.registration.count({
      where: { eventId: event.id, attendeeId: actor.id, status: { in: HOLDING_A_PLACE } },
    })) > 0;
  if (!canViewEvent(actor, { ...event, attendeeHoldsPlace })) {
    return hidden();
  }

  // ADDED: and even a visible event is not visible in full. An attendee gets
  // the public subset; the rejection reason, the assigned coordinator, the
  // client's special requirements and the venue and equipment arrangements
  // are internal planning information (briefing §8b).
  // ADDED (SPM-86): the latest safety check as `safetyCheck`, or null if the
  // event was never submitted. Safety details are internal (SPM-88): an
  // external user (the organiser, an attendee) sees the Safety review status
  // and nothing more.
  // SPM-88 (AC1): and every check, newest first, as `safetyHistory`.
  // SPM-29 (AC3): the open clarification, shown to the organiser and the
  // assigned coordinator - no one else gets the key, and it is looked up only
  // for them. Only while the event is Under review: approving, rejecting or
  // withdrawing ends the review, so the clarification is no longer shown
  // (PR #70 review - nothing else closes it until SPM-26).
  const { safetyChecks, ...withoutHistory } = event;
  const rest = canSeeClarification(actor, event)
    ? { ...withoutHistory, openClarification: await openClarificationOf(event) }
    : withoutHistory;
  const safetyHistory = (safetyChecks ?? []).map((check) => ({
    status: check.status,
    submittedAt: check.submittedAt,
    submittedBy: check.submitter?.fullName ?? null,
    decidedAt: check.decidedAt ?? null,
    decidedBy: check.decider?.fullName ?? null,
    decisionNote: check.decisionNote ?? null,
  }));
  const shaped = isExternalRole(actor.role)
    ? rest
    : {
        ...rest,
        venueBookings: await withVenueRestrictions(rest),
        safetyCheck: safetyHistory[0] ?? null,
        safetyHistory,
      };
  if (actor.role === "attendee") {
    // SPM-51 AC4: whether they can register now, and if not why - the same
    // rule POST /api/registrations applies.
    // AC6, AC7: and their own registration, so the page shows it instead of
    // offering a second one.
    const [seatsTaken, myRegistration] = await Promise.all([
      prisma.registration.count({ where: { eventId: event.id, status: { in: SEAT_TAKING } } }),
      prisma.registration.findUnique({
        where: { eventId_attendeeId: { eventId: event.id, attendeeId: actor.id } },
        // SPM-52: and its id, for Withdraw.
        select: { id: true, status: true, registeredAt: true },
      }),
    ]);
    return NextResponse.json(
      visibleEventFor(actor, {
        ...shaped,
        registrationState: registrationState(event, seatsTaken, new Date()),
        myRegistration: myRegistration ?? null,
      })
    );
  }
  // SPM-52 AC5: the organiser and the coordinator see how many places are
  // taken and how many attendees withdrew, so a withdrawal shows up here.
  if (can(actor.role, "registration:view_list")) {
    const byStatus = await prisma.registration.groupBy({
      by: ["status"],
      where: { eventId: event.id },
      _count: { _all: true },
    });
    return NextResponse.json(
      visibleEventFor(actor, {
        ...shaped,
        registrationCounts: registrationCounts(byStatus.map((s) => ({ status: s.status, count: s._count._all }))),
        // SPM-65: whether to offer the Attendees tab - the registration
        // list's own rule, so the tab is never shown only to be refused.
        canViewRegistrationList: canViewRegistrationList(actor, event),
      })
    );
  }
  return NextResponse.json(visibleEventFor(actor, shaped));
}

/// SPM-87 (AC2): "any recorded venue restrictions or unavailable periods" -
/// each booked venue's VenueUnavailability periods (SPM-45) that touch the
/// event's Singapore dates, for the safety review. Internal users only, like
/// the Venue bookings card that shows them.
async function withVenueRestrictions<B extends { venue: { id: string } }>(event: {
  startsAt: Date | null;
  endsAt: Date | null;
  venueBookings?: B[];
}) {
  const bookings = event.venueBookings;
  if (!bookings || bookings.length === 0 || !event.startsAt || !event.endsAt) return bookings;
  const periods = await prisma.venueUnavailability.findMany({
    where: {
      venueId: { in: [...new Set(bookings.map((b) => b.venue.id))] },
      startsAt: { lt: dayStart(dayIndex(event.endsAt) + 1) },
      endsAt: { gt: dayStart(dayIndex(event.startsAt)) },
    },
    select: { venueId: true, startsAt: true, endsAt: true, reason: true },
    orderBy: { startsAt: "asc" },
  });
  return bookings.map((b) => ({
    ...b,
    venue: {
      ...b.venue,
      unavailable: periods
        .filter((p) => p.venueId === b.venue.id)
        .map(({ startsAt, endsAt, reason }) => ({ startsAt, endsAt, reason })),
    },
  }));
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

    // CHANGED (SPM-31): see the matching comment in GET above.
    const sequenceNumber = parseEventReference(id);
    const event =
      sequenceNumber === null ? null : await prisma.event.findUnique({ where: { sequenceNumber } });
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
      return await handleStatusChange(event.id, actor, event, body);
    }
    return await handleDraftEdit(event.id, actor, event, body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    // (eventId, equipmentId) is unique across the whole event. Zod catches a
    // duplicate inside one payload; this catches one against rows already
    // stored - e.g. sessions saved alone while an event-wide request for the
    // same item still exists.
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
  // ADDED (SPM-86): there is one way into Safety review - POST
  // /api/events/[id]/safety-check, which checks the arrangements and records
  // the submission. Not this route.
  if (data.status === "safety_review") {
    return NextResponse.json(
      { error: "An event is sent for a safety check with Submit for safety check" },
      { status: 400 }
    );
  }

  if (!canSetEventStatus(actor, event, data.status)) {
    return forbidden(`Your role cannot move an event to "${data.status}"`);
  }

  // ADDED (SPM-27): the role may set this status, but only from where the
  // lifecycle allows it - no skipping steps, nothing out of a final status.
  if (!canTransition(event.status, data.status)) {
    return NextResponse.json({ error: transitionError(event.status, data.status) }, { status: 400 });
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

    // A multi-session event's own attendance is derived from its sessions (the
    // largest one), so it is non-null as soon as ANY session has a figure -
    // which would let a session with none through. Each session has to be
    // complete in its own right ("each with its own ... expected attendance").
    const sessions = await prisma.eventSession.findMany({
      where: { eventId: id },
      orderBy: { startsAt: "asc" },
      select: { expectedAttendance: true },
    });
    sessions.forEach((session, i) => {
      if (session.expectedAttendance == null) missing.push(`session ${i + 1} expectedAttendance`);
    });

    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Cannot submit an incomplete event. Missing: ${missing.join(", ")}` },
        { status: 400 }
      );
    }
  }

  // ADDED (SPM-28): approve and reject are review outcomes, decided once,
  // from Under review. See REVIEW_OUTCOMES in src/lib/permissions.ts.
  if (REVIEW_OUTCOMES.includes(data.status) && !REVIEWABLE_STATUSES.includes(event.status)) {
    return NextResponse.json(
      { error: "Only a request that is under review can be approved or rejected" },
      { status: 400 }
    );
  }

  // ADDED (SPM-54): there is one way into Planning - the coordinator's first
  // venue or equipment action on an Approved event, through
  // beginPlanningIfApproved() (src/lib/beginPlanning.ts). Not this route.
  if (data.status === "planning") {
    return NextResponse.json(
      { error: "Planning begins with the first venue or equipment action on an approved event" },
      { status: 400 }
    );
  }

  // ADDED (SPM-34): an event is confirmed only once the arrangements it
  // actually needs are in place (#80), and a refusal names the ones that are
  // not. The rule is in src/lib/eventConfirmation.ts so it can be unit tested
  // without a database; this route only gathers what it reads.
  //
  // CHANGED (SPM-33): what it reads is loadConfirmationInput(), shared with
  // the Readiness tab, so the two can never disagree about what is
  // outstanding - including review flags, registration setup and anything the
  // coordinator marked as not required.
  if (data.status === "confirmed") {
    // SPM-82 (AC5): an expired hold is never confirmed on.
    await expireDueHolds();
    const check = checkEventConfirmation(await loadConfirmationInput(event));
    if (!check.ok) {
      return NextResponse.json({ error: check.error, outstanding: check.outstanding }, { status: 400 });
    }
  }

  // ADDED: the brief requires a rejected request to retain the decision reason.
  if (data.status === "rejected" && !data.reason?.trim()) {
    return NextResponse.json(
      { error: "A reason is required when rejecting an event" },
      { status: 400 }
    );
  }

  // SPM-37 (AC8): the reason is optional; one of only spaces is none.
  const cancellationReason = data.status === "cancelled" ? data.reason?.trim() || null : null;

  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const e = await tx.event.update({
      where: { id },
      data: {
        status: data.status,
        // Keep the decision record on the event itself as well as in history.
        ...(data.status === "rejected" ? { rejectionReason: data.reason?.trim() } : {}),
        ...(data.status === "cancelled" ? { cancellationReason } : {}),
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
        reason: data.status === "cancelled" ? (cancellationReason ?? undefined) : data.reason,
      },
    });

    // SPM-37: everything the event holds is let go with it (AC3-AC6).
    if (data.status === "cancelled") {
      await releaseForCancellation(tx, e, actor, cancellationReason);
    }

    // SPM-25 AC: "the relevant users receive a notification that the request
    // has been submitted". No coordinator is assigned yet at this point in
    // the process (that's Step 3, the Ops Manager's job - see
    // STATUS_TRANSITION_ROLES.under_review), so the Ops Manager queue (S-28)
    // is who needs to act next and who is notified.
    if (data.status === "submitted") {
      await notifyRole(tx, "ops_manager", {
        type: "event_submitted",
        title: "New event request submitted",
        body: `"${e.title}" has been submitted and needs a coordinator assigned.`,
        eventId: id,
      });
    }

    return e;
  });

  return NextResponse.json(updated);
}

/**
 * SPM-37: what a cancellation lets go, in the status change's transaction
 * (src/lib/eventCancellation.ts says what each becomes). Registrations are
 * left as they are (AC7, SPM-52).
 */
async function releaseForCancellation(
  tx: Prisma.TransactionClient,
  event: { id: string; sequenceNumber: number; title: string | null },
  actor: Actor,
  reason: string | null
) {
  const now = new Date();
  const note = arrangementCancellationNote(reason);

  // Read before they change: Venue Staff are told of each released booking.
  const released = await tx.venueBooking.findMany({
    where: { eventId: event.id, status: "approved" },
    select: {
      startsAt: true,
      endsAt: true,
      venue: { select: { name: true, code: true } },
      session: { select: { label: true } },
    },
    orderBy: { startsAt: "asc" },
  });

  // AC3, AC4: SPM-67's statuses - released frees the room, withdrawn takes the
  // request off Venue Staff's Booking Requests list.
  const taken = { cancelledBy: actor.id, cancelledAt: now, cancellationReason: note };
  await tx.venueBooking.updateMany({
    where: { eventId: event.id, status: "approved" },
    data: { status: "released", ...taken },
  });
  await tx.venueBooking.updateMany({
    where: { eventId: event.id, status: "pending" },
    data: { status: "withdrawn", ...taken },
  });

  // AC3: every line, reserved or not - nothing stays committed or queued.
  await tx.equipmentRequest.updateMany({
    where: { eventId: event.id, status: { not: "cancelled" } },
    data: { status: "cancelled" },
  });

  // AC5: closed, not decided - nothing they propose reaches the event.
  await tx.eventChangeRequest.updateMany({
    where: { eventId: event.id, status: "pending" },
    data: { status: "withdrawn", reviewedBy: actor.id, reviewedAt: now, reviewNotes: CHANGE_REQUEST_CLOSED_NOTE },
  });

  // AC6: a pending check leaves the Safety Officer's list with the status
  // change; an approved one must not stay live either.
  await closeSafetyCheck(tx, event.id, actor.id, SAFETY_CHECK_CLOSED_NOTE, now);

  // As SPM-67 AC7 (decided 2026-10-21): Venue Staff had set these rooms aside.
  if (released.length > 0) {
    const coordinator = await tx.user.findUnique({ where: { id: actor.id }, select: { fullName: true } });
    for (const booking of released) {
      await notifyRole(
        tx,
        "venue_staff",
        releaseNotification({
          // v8 ignore next -- the actor was looked up to sign them in, so their row exists
          coordinatorName: coordinator?.fullName ?? "The assigned Coordinator",
          venueName: booking.venue.name,
          venueCode: booking.venue.code,
          eventId: event.id,
          eventReference: eventReference(event.sequenceNumber),
          eventTitle: event.title,
          sessionLabel: booking.session?.label ?? null,
          startsAt: booking.startsAt,
          endsAt: booking.endsAt,
          reason: note,
        })
      );
    }
  }
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
  //
  // An event edited into sessions takes its own start / end / headcount from
  // them (see deriveEventFromSessions), overriding anything sent alongside.
  const derived = deriveEventFromSessions(data.sessions);
  const startsAt = derived
    ? derived.startsAt
    : data.startsAt !== undefined
      ? new Date(data.startsAt)
      : event.startsAt;
  const endsAt = derived
    ? derived.endsAt
    : data.endsAt !== undefined
      ? new Date(data.endsAt)
      : event.endsAt;
  const registrationEnabled =
    data.registrationEnabled !== undefined ? data.registrationEnabled : event.registrationEnabled;
  const registrationCapacity =
    data.registrationCapacity !== undefined ? data.registrationCapacity : event.registrationCapacity;
  const registrationOpensAt =
    data.registrationOpensAt !== undefined ? new Date(data.registrationOpensAt) : event.registrationOpensAt;
  const registrationClosesAt =
    data.registrationClosesAt !== undefined ? new Date(data.registrationClosesAt) : event.registrationClosesAt;

  // Keyed by field, not a flat list: readServerError() (src/lib/formErrors.ts)
  // only renders a message inline under the field it names, via the same
  // `details.fieldErrors` shape Zod's flatten() produces. A bare `{ error }`
  // string is never attributed to a field, so it always falls back to a
  // top-of-form Alert - wrong for a rule like "ends at must be after starts
  // at" that a tester expects to see under Ends at (UI_DESIGN.md §7.2: "Field
  // error" vs "Form error" is a matter of attributability, not which layer
  // caught the rule).
  const fieldErrors: Record<string, string> = {};
  if (startsAt && endsAt && endsAt <= startsAt) {
    fieldErrors.endsAt = "Ends at must be after starts at.";
  }
  if (registrationEnabled && registrationCapacity == null) {
    fieldErrors.registrationCapacity = "Registration capacity is required when registration is enabled.";
  }
  if (registrationOpensAt && registrationClosesAt && registrationClosesAt <= registrationOpensAt) {
    fieldErrors.registrationClosesAt = "Registration closes at must be after it opens.";
  }
  if (registrationOpensAt && startsAt && registrationOpensAt >= startsAt) {
    fieldErrors.registrationOpensAt = "Registration must open before the event starts.";
  }
  // Mirrors the `!errors.registrationClosesAt` guard in validateForm()
  // (src/lib/eventForm.ts): don't let this second rule stomp on a message
  // the "must be after it opens" check already set for the same field.
  if (registrationClosesAt && startsAt && registrationClosesAt >= startsAt && !fieldErrors.registrationClosesAt) {
    fieldErrors.registrationClosesAt = "Registration must close before the event starts.";
  }
  if (data.equipment?.length && (!startsAt || !endsAt)) {
    fieldErrors.equipment = "Set the event date and time before requesting equipment.";
  }
  const firstField = Object.keys(fieldErrors)[0];
  if (firstField) {
    return NextResponse.json(
      {
        error: fieldErrors[firstField],
        details: { fieldErrors: Object.fromEntries(Object.entries(fieldErrors).map(([f, m]) => [f, [m]])) },
      },
      { status: 400 }
    );
  }

  // Equipment is held wider than the event, same as on create.
  const equipmentTimes = startsAt && endsAt ? equipmentWindow(startsAt, endsAt) : null;

  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // A field that's being replaced is cleared first and rebuilt from the
    // payload below - simpler than diffing rows against what's already there.
    if (data.facilityIds !== undefined) {
      await tx.eventFacilityRequirement.deleteMany({ where: { eventId: id } });
    }
    // Event-wide equipment only (sessionId null): a session's own requests are
    // replaced with the session, below, and must survive an edit that only
    // touches the event-level list.
    if (data.equipment !== undefined) {
      await tx.equipmentRequest.deleteMany({ where: { eventId: id, sessionId: null } });
    }
    // The onDelete: Cascade on EquipmentRequest.session takes each session's
    // equipment with it. `[]` lands here too, which is how multi-session is
    // turned off.
    if (data.sessions !== undefined) {
      await tx.eventSession.deleteMany({ where: { eventId: id } });
      if (data.sessions.length > 0) {
        await writeSessions(tx, id, actor.id, data.sessions);
      }
    }

    return tx.event.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.purpose !== undefined ? { purpose: data.purpose } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(derived || data.startsAt !== undefined ? { startsAt } : {}),
        ...(derived || data.endsAt !== undefined ? { endsAt } : {}),
        ...(derived?.expectedAttendance !== undefined
          ? { expectedAttendance: derived.expectedAttendance }
          : derived === null && data.expectedAttendance !== undefined
            ? { expectedAttendance: data.expectedAttendance }
            : {}),
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
      include: {
        facilityRequirements: { select: { facilityId: true, isMandatory: true } },
        equipmentRequests: {
          select: {
            id: true,
            equipmentId: true,
            quantityRequested: true,
            technicalRequirements: true,
            status: true,
            sessionId: true,
          },
        },
        sessions: { select: SESSION_SELECT, orderBy: { startsAt: "asc" } },
      },
    });
  });

  return NextResponse.json(updated);
}

/// The event's open clarification as the pages show it, or null - none is
/// shown once the event has left Under review (SPM-29, PR #70 review).
async function openClarificationOf(event: { id: string; status: string }) {
  if (!REVIEWABLE_STATUSES.includes(event.status)) return null;
  const open = await prisma.clarificationRequest.findFirst({
    where: { eventId: event.id, status: "open" },
    select: { id: true, fields: true, message: true, requestedAt: true, requester: { select: { fullName: true } } },
  });
  return open ? { ...open, fields: decodeFields(open.fields) } : null;
}
