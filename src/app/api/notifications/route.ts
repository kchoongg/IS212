import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, unauthenticated } from "@/lib/apiAuth";
import { eventReference } from "@/lib/format";
import { notificationHref } from "@/lib/notificationView";

/**
 * SPM-71 (View Notifications), S-04 — the signed-in user's own notifications,
 * newest first (AC1, AC7). Personal, so there is no role permission: being
 * signed in is the whole requirement, and the query is scoped to the caller.
 *
 * Each carries what happened (title, body), when, whether it has been read,
 * the event it is about - its reference and title only, nothing a notification
 * did not already say (AC2) - and `href`, where selecting it goes (AC5).
 * Whether the user may still see that screen is decided there (AC6).
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }

    const rows = await prisma.notification.findMany({
      where: { recipientId: actor.id },
      // Newest first; id breaks a tie between two written in the same instant
      // (notifyRole() writes a whole role's at once) so the order is stable.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        isRead: true,
        createdAt: true,
        event: { select: { sequenceNumber: true, title: true } },
      },
    });

    return NextResponse.json(
      rows.map(({ event, ...note }) => {
        const reference = event ? eventReference(event.sequenceNumber) : null;
        return {
          ...note,
          event: event ? { reference, title: event.title } : null,
          href: notificationHref(note.type, reference),
        };
      })
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
