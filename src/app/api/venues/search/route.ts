import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { can, canViewEvent } from "@/lib/permissions";
import { parseEventReference } from "@/lib/format";
import { venueSearchQuerySchema } from "@/lib/validation";
import { parseWallClock, searchVenues, type VenueSearchFilters } from "@/lib/venueSearch";

// SPM-40, Search and Filter Suitable Venues. Every active venue, narrowed to
// the ones matching EVERY filter given (AC7) - the rules are in
// src/lib/venueSearch.ts. Read-only: it books nothing and changes no status.
//
// GET /api/venues/search?from=2026-12-09T09:00&to=2026-12-09T18:00
//     &attendance=200&building=Marina%20Centre&layout=theatre
//     &facilityIds=<uuid>,<uuid>&event=EVT-000123
//
// Every parameter is optional; none at all returns the whole active catalogue.

/// Bookings and blocks further than this from the requested window cannot
/// reach it: a booking reaches only as far as its venue's setup and turnaround
/// minutes (SPM-93), which are hours, not days. Two days is a margin, not a rule.
const NEIGHBOUR_MS = 2 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }
  // The venue catalogue is staff-only (see GET /api/venues) - the organiser
  // expresses preferences, the coordinator picks the venue (#111).
  if (!can(actor.role, "venue:view")) {
    return forbidden("Venue search is for ConnectSphere staff");
  }

  const parsed = venueSearchQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries())
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const query = parsed.data;

  // The regex in the schema only checks the shape; this catches 31 February.
  let window: VenueSearchFilters["window"];
  if (query.from && query.to) {
    const startsAt = parseWallClock(query.from);
    const endsAt = parseWallClock(query.to);
    if (!startsAt || !endsAt) {
      return NextResponse.json({ error: "That is not a real date and time" }, { status: 400 });
    }
    window = { startsAt, endsAt };
  }

  // Searching FOR an event only changes one thing: that event's own bookings
  // stop counting against a venue. The event must be one this user may see -
  // same 404-not-403 rule as GET /api/events/[id], so its existence is not
  // confirmed to someone who could not open it.
  let eventId: string | undefined;
  if (query.event) {
    const sequenceNumber = parseEventReference(query.event);
    const event =
      sequenceNumber === null ? null : await prisma.event.findUnique({ where: { sequenceNumber } });
    if (!event || !canViewEvent(actor, event)) {
      return hidden();
    }
    eventId = event.id;
  }

  // Retired venues are out of the catalogue, so they are never search results
  // (SPM-39 AC6: inactive venues are not presented as available options).
  const venues = await prisma.venue.findMany({
    where: { isActive: true },
    include: {
      layouts: true,
      facilities: { include: { facility: true } },
      // Only loaded when a date filter is set, and only what could reach the
      // requested window. Rejected and cancelled requests never block.
      bookings: window
        ? {
            where: {
              status: { in: ["approved", "pending"] },
              startsAt: { lt: new Date(window.endsAt.getTime() + NEIGHBOUR_MS) },
              endsAt: { gt: new Date(window.startsAt.getTime() - NEIGHBOUR_MS) },
            },
            select: { eventId: true, status: true, startsAt: true, endsAt: true },
          }
        : false,
      unavailability: window
        ? {
            where: {
              startsAt: { lt: new Date(window.endsAt.getTime() + NEIGHBOUR_MS) },
              endsAt: { gt: new Date(window.startsAt.getTime() - NEIGHBOUR_MS) },
            },
            select: { startsAt: true, endsAt: true, reason: true },
          }
        : false,
    },
  });

  const results = searchVenues(
    venues.map((v) => ({
      ...v,
      facilityIds: v.facilities.map((f) => f.facilityId),
      bookings: v.bookings ?? [],
      unavailability: v.unavailability ?? [],
    })),
    {
      window,
      attendance: query.attendance,
      building: query.building,
      layout: query.layout,
      facilityIds: query.facilityIds,
      eventId,
    }
  );

  return NextResponse.json({
    // How many venues were searched, so "0 of 16 match" can be told apart from
    // an empty catalogue.
    checked: venues.length,
    // The location filter's options: every building with an active venue,
    // regardless of the other filters, so picking one never empties the list
    // of the others.
    buildings: Array.from(new Set(venues.map((v) => v.building))).sort(),
    results: results.map((v) => ({
      id: v.id,
      code: v.code,
      name: v.name,
      building: v.building,
      floor: v.floor,
      maxCapacity: v.maxCapacity,
      opensAt: v.opensAt,
      closesAt: v.closesAt,
      layouts: v.layouts
        .map((l) => ({ layoutName: l.layoutName, capacity: l.capacity }))
        .sort((a, b) => b.capacity - a.capacity),
      facilities: v.facilities
        .map((f) => ({ id: f.facility.id, name: f.facility.name, category: f.facility.category }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })),
  });
}
