import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addReviewReasons } from "@/lib/reviewFlags";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { can } from "@/lib/permissions";
import { updateVenueSchema } from "@/lib/validation";
import {
  assessVenueEdit,
  formatReviewReason,
  impactSentence,
  mergeReasons,
  parseReviewReason,
  reviewCandidateWhere,
  type BookingState,
  type VenueState,
} from "@/lib/venueImpact";
import { notifyUser } from "@/lib/notifications";
import { formatDateTimeRange, formatVenue } from "@/lib/format";
import { ZodError } from "zod";
import type { Prisma } from "@prisma/client";

const VENUE_INCLUDE = {
  layouts: true,
  facilities: { include: { facility: true } },
} as const;

/// Plain 404, not apiAuth's hidden(): that one says "Event not found" and
/// exists because an event can be a record the caller may not know about. The
/// venue catalogue is not like that - every caller here has already passed
/// venue:view, so there is nothing to conceal, only a missing row to report.
function venueNotFound() {
  return NextResponse.json({ error: "Venue not found" }, { status: 404 });
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }
  if (!can(actor.role, "venue:view")) {
    return forbidden("The venue catalogue is for ConnectSphere staff");
  }

  const venue = await prisma.venue.findUnique({ where: { id }, include: VENUE_INCLUDE });
  if (!venue) {
    return venueNotFound();
  }
  return NextResponse.json(venue);
}

/**
 * Update a venue's attributes, or retire it.
 *
 * Retiring is `isActive: false` and nothing else - there is no delete. Venue
 * is documented as "retire a venue without orphaning its past bookings"
 * (schema.prisma), and VenueBooking holds a plain foreign key to it with no
 * cascade, so a real delete of a booked room would be refused by the database
 * anyway. Both edits share this one endpoint because both have the same
 * consequence for existing bookings, which is the whole point of the story:
 *
 *   AC (Manage Venue Catalogue, discussion board #120 and #122): "When a
 *   venue's attributes are updated or it is retired, existing bookings that
 *   may be affected are flagged for review rather than automatically changed,
 *   and the assigned Coordinator is notified."
 *
 * "Rather than automatically changed" is the load-bearing half. This endpoint
 * never touches a booking's venue, layout, times or status, and never touches
 * the event - the events domain is Kristen's (SCHEMA_REFERENCE.md § "Who owns
 * what") and a room that no longer fits is a judgement call for the
 * coordinator, not a silent rewrite. The only writes are the venue itself, the
 * review flag on affected bookings, and one notification each.
 *
 * Which bookings count as affected is defined in src/lib/venueImpact.ts, with
 * the rules unit tested there. Deliberately NOT yet checked: whether narrowed
 * opening hours (opensAt/closesAt) now fall outside a booking's window.
 * opensAt is wall-clock text and booking.startsAt is a DateTime, so that
 * comparison needs a timezone convention this codebase has not settled yet -
 * the booking-hours check is still unwritten (SCHEMA_REFERENCE.md lists it
 * under rules the database does not enforce). Deferred rather than guessed:
 * a wrong assumption there produces false flags on every edit.
 *
 * The edit is never blocked by the impact it has. The AC says flag, not
 * prevent - so the response reports what was flagged and lets the UI say so.
 */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    // Venue Staff "are responsible for venue information" (briefing §3), the
    // same permission that guards adding one in POST /api/venues.
    if (!can(actor.role, "venue:manage")) {
      return forbidden("Only Venue Staff can change a venue");
    }

    const body = await req.json();
    const data = updateVenueSchema.parse(body);

    // facilityIds and layouts are relations, not columns; `reason` is not
    // stored at all - it goes into the notification body.
    const { facilityIds, layouts, reason, ...venueFields } = data;

    // One transaction: read the venue, work out the impact, write the venue,
    // flag and notify. Two people editing the same room at the same moment
    // would otherwise both compute their impact against a state neither of
    // them ends up saving.
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const venue = await tx.venue.findUnique({
        where: { id },
        include: { layouts: true, facilities: true },
      });
      if (!venue) {
        return { error: "Venue not found", status: 404 } as const;
      }

      if (venueFields.code !== undefined && venueFields.code !== venue.code) {
        const clash = await tx.venue.findUnique({ where: { code: venueFields.code } });
        if (clash) {
          return { error: "A venue with this code already exists", status: 400 } as const;
        }
      }

      const before: VenueState = {
        isActive: venue.isActive,
        maxCapacity: venue.maxCapacity,
        layouts: venue.layouts.map((l) => ({ layoutName: l.layoutName, capacity: l.capacity })),
        facilityIds: venue.facilities.map((f) => f.facilityId),
      };
      // An absent field means "leave this alone", so the after state is the
      // before state with only what was sent applied on top. A present
      // `layouts` or `facilityIds` replaces that relation outright - which is
      // the only way a layout or facility gets removed, and removal is what
      // breaks existing bookings.
      const after: VenueState = {
        isActive: venueFields.isActive ?? before.isActive,
        maxCapacity: venueFields.maxCapacity ?? before.maxCapacity,
        layouts: layouts ?? before.layouts,
        facilityIds: facilityIds ?? before.facilityIds,
      };

      const now = new Date();
      const candidates = await tx.venueBooking.findMany({
        where: { venueId: id, ...reviewCandidateWhere(now) },
        include: {
          // A multi-session event books each session separately (SPM-25), and
          // a session carries its own expectedAttendance. Null on the session
          // means "same as the event", which is why both are loaded.
          session: { select: { label: true, expectedAttendance: true } },
          event: {
            select: {
              id: true,
              title: true,
              coordinatorId: true,
              expectedAttendance: true,
              // Mandatory only. A missing nice-to-have must not disqualify a
              // venue, so it must not flag a booking either.
              //
              // Event-scoped, not session-scoped: EventFacilityRequirement has
              // no sessionId, so there is no session-level list to prefer here.
              // If sessions ever gain their own requirements, this needs the
              // same ?? fallback as expectedAttendance below.
              facilityRequirements: {
                where: { isMandatory: true },
                select: { facilityId: true },
              },
            },
          },
        },
      });

      const bookingStates: BookingState[] = candidates.map((booking) => ({
        id: booking.id,
        layoutName: booking.layoutName,
        // Session data wins when present, event data is the fallback. A
        // session-specific booking must be judged against the headcount for
        // THAT session - a 20-person breakout in a multi-day conference is not
        // affected by a room that no longer seats the whole event.
        expectedAttendance:
          booking.session?.expectedAttendance ?? booking.event.expectedAttendance,
        mandatoryFacilityIds: booking.event.facilityRequirements.map((r) => r.facilityId),
      }));
      const affected = assessVenueEdit(before, after, bookingStates);

      // A replaced relation is cleared and rebuilt from the payload, the same
      // way a draft edit does it in api/events/[id] - simpler than diffing
      // rows, and an empty array then correctly means "remove them all".
      if (layouts !== undefined) {
        await tx.venueLayout.deleteMany({ where: { venueId: id } });
      }
      if (facilityIds !== undefined) {
        await tx.venueFacility.deleteMany({ where: { venueId: id } });
      }

      const updated = await tx.venue.update({
        where: { id },
        data: {
          ...venueFields,
          layouts: layouts?.length ? { create: layouts } : undefined,
          facilities: facilityIds?.length
            ? { create: facilityIds.map((facilityId) => ({ facilityId })) }
            : undefined,
        },
        include: VENUE_INCLUDE,
      });

      const venueLabel = formatVenue(updated.name, updated.code);
      const flaggedBookings = [];

      for (const impact of affected) {
        const booking = candidates.find((b) => b.id === impact.bookingId);
        if (!booking) continue;

        // Keep whatever an earlier edit flagged. assessVenueEdit() only ever
        // reports newly introduced problems, so these reasons are additional
        // to any already on the row, not a correction of them.
        const stored = booking.needsReview ? booking.reviewReason : null;
        const reasons = mergeReasons(parseReviewReason(stored), impact.reasons);

        await tx.venueBooking.update({
          where: { id: booking.id },
          data: {
            needsReview: true,
            // The venue reasons in their usual order, then every other code
            // already there - the column is shared with other stories
            // (SPM-62's event changes), whose codes parseReviewReason() drops.
            reviewReason: addReviewReasons(formatReviewReason(reasons), stored?.split(",") ?? []),
            flaggedAt: now,
          },
        });

        // "The assigned Coordinator is notified." coordinatorId is nullable -
        // an event that has not been assigned yet has no assigned coordinator
        // to notify - so the requester falls in behind it: they are the person
        // who asked for this room and in practice the coordinator who will
        // have to find another one.
        const recipientId = booking.event.coordinatorId ?? booking.requestedBy;
        const retired = impact.reasons.includes("venue_retired");
        // Named person, not a role queue: notifyUser() rather than
        // notifyRole(), because "the assigned Coordinator" is one specific
        // person per affected booking.
        await notifyUser(tx, recipientId, {
          type: retired ? "booking_venue_retired" : "booking_needs_review",
          title: retired ? "Venue retired - booking needs review" : "Booking needs review",
          body:
            `${venueLabel}: ${impactSentence(impact.reasons)}. ` +
            `The approved booking for ${booking.event.title ?? "an event"}` +
            // Which session, when the booking belongs to one: eventId alone
            // cannot tell a coordinator which of a multi-day event's sessions
            // this is about.
            `${booking.session?.label ? ` (${booking.session.label})` : ""} on ` +
            `${formatDateTimeRange(booking.startsAt, booking.endsAt)} is flagged for review - ` +
            `nothing has been changed automatically.` +
            (reason ? ` Reason given: ${reason}` : ""),
          // Notification has no venue or booking column, only eventId, so the
          // room and the dates have to be spelled out in the body above or the
          // coordinator cannot tell which booking this is about.
          eventId: booking.eventId,
        });

        flaggedBookings.push({
          bookingId: booking.id,
          eventId: booking.eventId,
          eventTitle: booking.event.title,
          sessionId: booking.sessionId,
          sessionLabel: booking.session?.label ?? null,
          reasons: impact.reasons,
          notifiedUserId: recipientId,
        });
      }

      return { venue: updated, flaggedBookings } as const;
    });

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Wrapped rather than the bare venue that GET and POST return: without the
    // impact in the response the UI cannot tell anyone "3 bookings flagged,
    // coordinators notified", and an AC nobody can see happen is an AC nobody
    // trusts.
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
