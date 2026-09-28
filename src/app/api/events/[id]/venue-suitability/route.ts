import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { can, canViewEvent } from "@/lib/permissions";
import { parseEventReference } from "@/lib/format";
import { assessVenues, missingEventInputs, type EventNeeds } from "@/lib/venueSuitability";

// SPM-41. Every active venue, judged against this event's attendance, layout,
// facilities and accessibility requirements. Read-only: it books nothing.

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }
  // The venue catalogue is staff-only information (see GET /api/venues).
  if (!can(actor.role, "venue:view")) {
    return forbidden("Venue suitability is for ConnectSphere staff");
  }

  // FIXED (found in review of PR #21): `id` is the event's reference (e.g.
  // "EVT-000123"), not its underlying id, since SPM-31 - see the sibling
  // /equipment route. This route still looked the event up by the raw route
  // segment, so the Venue tab's "Find a venue" link 404'd for every event.
  //
  // One query, like the other routes that need the full row rather than just
  // an id to scope a foreign key - resolveEventId() (src/lib/apiAuth.ts) is
  // for the latter and would cost a second round trip here (caught in
  // review).
  const sequenceNumber = parseEventReference(id);
  const event =
    sequenceNumber === null
      ? null
      : await prisma.event.findUnique({
          where: { sequenceNumber },
          include: { facilityRequirements: { include: { facility: true } } },
        });
  // Same rule as GET /api/events/[id]: an event the user may not see is 404,
  // not 403, so its existence is not confirmed.
  if (!event || !canViewEvent(actor, event)) {
    return hidden();
  }

  // Retired venues are out of the catalogue, so they are not offered here
  // either - retiring a room has to mean something.
  const venues = await prisma.venue.findMany({
    where: { isActive: true },
    include: { layouts: true, facilities: true },
  });

  const needs: EventNeeds = {
    expectedAttendance: event.expectedAttendance,
    preferredLayout: event.preferredLayout,
    requirements: event.facilityRequirements.map((r) => ({
      facilityId: r.facilityId,
      name: r.facility.name,
      category: r.facility.category,
      isMandatory: r.isMandatory,
    })),
  };

  const results = assessVenues(
    needs,
    venues.map((v) => ({
      id: v.id,
      code: v.code,
      name: v.name,
      building: v.building,
      floor: v.floor,
      maxCapacity: v.maxCapacity,
      layouts: v.layouts,
      facilityIds: v.facilities.map((f) => f.facilityId),
    }))
  );

  return NextResponse.json({
    event: {
      expectedAttendance: needs.expectedAttendance,
      preferredLayout: needs.preferredLayout,
      requirements: needs.requirements,
      // What the event has not said yet, so the screen can explain a check
      // that ran in part.
      missing: missingEventInputs(needs),
    },
    results: results.map(({ venue, suitable, unmet, optionalMissing }) => ({
      venue: {
        id: venue.id,
        code: venue.code,
        name: venue.name,
        building: venue.building,
        floor: venue.floor,
        maxCapacity: venue.maxCapacity,
        layouts: venue.layouts.map((l) => ({ layoutName: l.layoutName, capacity: l.capacity })),
      },
      suitable,
      unmet,
      optionalMissing,
    })),
  });
}
