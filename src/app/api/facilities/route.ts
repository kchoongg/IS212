import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

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
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const facilities = await prisma.facility.findMany({
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: { id: true, name: true, category: true },
  });

  return NextResponse.json(facilities);
}
