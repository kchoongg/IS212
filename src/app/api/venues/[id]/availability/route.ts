import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { can } from "@/lib/permissions";
import { venueAvailabilityQuerySchema } from "@/lib/validation";
import { buildAvailability, resolveAvailabilityRange } from "@/lib/venueAvailability";
import { addDays, localDayKey, localDayStart } from "@/lib/venueTime";
import { TIME_ZONE } from "@/lib/format";

/**
 * GET /api/venues/[id]/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * SPM-46 "View Venue Availability" - S-21 in UI_DESIGN.md. One venue, a range
 * of local calendar days, and for each day what occupies the room and when -
 * since SPM-93 at actual times, setup and turnaround as their own entries.
 *
 *   AC1  select a venue and a period          - the path id, `from` and `to`
 *   AC2  including setup/turnaround           - `days[].entries`, kinds "setup" and "turnaround"
 *   AC3  confirmed bookings are displayed     - `bookings`
 *   AC4  unavailable periods are displayed    - `unavailability`
 *   AC5  overlapping periods identifiable     - `overlaps` on each, and `hasOverlaps`
 *   AC6  authorised internal users only       - venue:view, below
 *   AC7  reflects confirmed bookings          - the status filter, below
 *
 * This route only loads rows. What the calendar says is decided in
 * src/lib/venueAvailability.ts and src/lib/venueTime.ts, as pure functions
 * with their own tests.
 */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }
  // AC6. venue:view is held by exactly the internal roles that work with rooms
  // - coordinator, ops manager and Venue Staff - and not by organisers or
  // attendees. The same gate as the venue catalogue itself.
  if (!can(actor.role, "venue:view")) {
    return forbidden("Venue availability is for ConnectSphere staff");
  }

  const query = venueAvailabilityQuerySchema.safeParse({
    from: req.nextUrl.searchParams.get("from") ?? undefined,
    to: req.nextUrl.searchParams.get("to") ?? undefined,
  });
  if (!query.success) {
    return NextResponse.json(
      { error: "Validation failed", details: query.error.flatten() },
      { status: 400 }
    );
  }

  // "Today" is the local day in the display timezone, so the default range
  // starts on the day the user is actually looking at.
  const range = resolveAvailabilityRange(query.data, localDayKey(new Date()));
  if ("error" in range) {
    return NextResponse.json({ error: range.error }, { status: 400 });
  }

  const venue = await prisma.venue.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      name: true,
      opensAt: true,
      closesAt: true,
      setupMinutes: true,
      teardownMinutes: true,
      isActive: true,
    },
  });
  if (!venue) {
    return NextResponse.json({ error: "Venue not found" }, { status: 404 });
  }

  // The range as instants: local midnight at the start of `from`, to local
  // midnight after `to`.
  const rangeStart = localDayStart(range.from);
  const rangeEnd = localDayStart(addDays(range.to, 1));

  // A booking just outside the range can still reach into it through its setup
  // or turnaround, so the booking query is widened by this venue's own minutes.
  // Without that, a 01:00 booking the day after `to` whose 180-minute setup
  // starts at 22:00 the night before would be missed.
  const setupMs = venue.setupMinutes * 60_000;
  const teardownMs = venue.teardownMinutes * 60_000;

  const [bookings, unavailability] = await Promise.all([
    prisma.venueBooking.findMany({
      where: {
        venueId: id,
        // AC3 and AC7 - DECIDED on SPM-46: "confirmed bookings" means the
        // booking's own status is `approved`, the state that commits the room.
        // NOT Event.status = "confirmed": that reading hides an approved
        // booking whose event is still in planning (Marina Grand Hall, 1 Dec
        // 2026, in the seed) and would let someone else book the same time.
        //
        // Pending ones are FETCHED too, as tentative holds (#41: "only one
        // active tentative hold or confirmed booking should exist for the same
        // venue and overlapping time period"). They are split out below and
        // shown as "requested" - a coordinator needs to see that a room has
        // already been asked for. Rejected and cancelled ones are not shown.
        status: { in: ["approved", "pending"] },
        // Overlap test from SCHEMA_REFERENCE.md, against the widened window.
        startsAt: { lt: new Date(rangeEnd.getTime() + setupMs) },
        endsAt: { gt: new Date(rangeStart.getTime() - teardownMs) },
      },
      include: {
        // Read only - the events domain is Kristen's, and the event's status
        // is shown on the calendar without ever deciding availability.
        event: { select: { title: true, status: true } },
        session: { select: { label: true } },
      },
      orderBy: { startsAt: "asc" },
    }),
    prisma.venueUnavailability.findMany({
      where: {
        venueId: id,
        startsAt: { lt: rangeEnd },
        endsAt: { gt: rangeStart },
      },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  return NextResponse.json(
    buildAvailability({
      venue,
      from: range.from,
      to: range.to,
      timeZone: TIME_ZONE,
      holds: bookings
        .filter((b) => b.status === "pending")
        .map((b) => ({
          id: b.id,
          startsAt: b.startsAt,
          endsAt: b.endsAt,
          eventId: b.eventId,
          eventTitle: b.event.title,
        })),
      bookings: bookings
        .filter((b) => b.status === "approved")
        .map((b) => ({
        id: b.id,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        layoutName: b.layoutName,
        eventId: b.eventId,
        eventTitle: b.event.title,
        eventStatus: b.event.status,
        sessionLabel: b.session?.label ?? null,
      })),
      unavailability: unavailability.map((u) => ({
        id: u.id,
        startsAt: u.startsAt,
        endsAt: u.endsAt,
        reason: u.reason,
        notes: u.notes,
      })),
    })
  );
}
