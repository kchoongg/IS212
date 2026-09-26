import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, hidden, unauthenticated } from "@/lib/apiAuth";
import { can, canViewEvent } from "@/lib/permissions";
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

  const event = await prisma.event.findUnique({
    where: { id },
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
