import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { can } from "@/lib/permissions";

/**
 * Reference data for the event request form (S-08) and venue search (S-14).
 *
 * Facilities are what make venue suitability checkable: an event that stores
 * "needs a hearing loop" as prose cannot be matched against the venues that
 * have one, which is why this endpoint exists before S-14 can be built.
 *
 * `category` splits the list into the two groups the UI shows separately:
 * `facility` (what the room has) and `accessibility` (what attendees need).
 */
export async function GET(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) {
    return unauthenticated();
  }
  // Reference data every role is allowed to read - it describes what a room
  // can have, not what any event is doing.
  if (!can(actor.role, "facility:view")) {
    return forbidden();
  }

  const facilities = await prisma.facility.findMany({
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: { id: true, name: true, category: true },
  });

  return NextResponse.json(facilities);
}
