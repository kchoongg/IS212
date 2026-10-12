import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, forbidden, unauthenticated } from "@/lib/apiAuth";
import { can } from "@/lib/permissions";

/**
 * SPM-85 — the data behind the Safety Officer's Safety Checks page.
 *
 * Every event waiting for an Operational Safety Check: in Safety review, which
 * SPM-86's "Submit for safety check" is the only way into. Each carries who
 * submitted it and when (its latest SafetyCheck row), oldest first - the order
 * they should be checked in. The review information itself is on the event
 * (the Overview and Equipment tabs), not repeated here.
 *
 * `event:safety_check` is the Safety Officer's alone (AC8): every other role
 * is refused before anything is read.
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    if (!can(actor.role, "event:safety_check")) {
      return forbidden("Only the Safety Officer works the Operational Safety Check");
    }

    const events = await prisma.event.findMany({
      where: { status: "safety_review" },
      select: {
        id: true,
        sequenceNumber: true,
        title: true,
        status: true,
        startsAt: true,
        endsAt: true,
        expectedAttendance: true,
        organisation: { select: { name: true } },
        // One row per submission (SPM-86); the latest is the one waiting.
        safetyChecks: {
          orderBy: { submittedAt: "desc" },
          take: 1,
          select: { submittedAt: true, submitter: { select: { fullName: true } } },
        },
      },
    });

    const rows = events.map(({ safetyChecks, ...event }) => ({
      ...event,
      submittedAt: safetyChecks[0]?.submittedAt ?? null,
      submittedBy: safetyChecks[0]?.submitter.fullName ?? null,
    }));
    // Oldest submission first. An event with no recorded submission should
    // not exist, but if one does it is listed last rather than dropped.
    const waitingSince = (row: (typeof rows)[number]) =>
      row.submittedAt ? new Date(row.submittedAt).getTime() : Number.MAX_SAFE_INTEGER;
    rows.sort((a, b) => waitingSince(a) - waitingSince(b));

    return NextResponse.json(rows);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
