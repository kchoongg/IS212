import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, unauthenticated } from "@/lib/apiAuth";

/// SPM-71 (AC3): how many of the caller's own notifications are unread - the
/// number on the top-bar bell and the sidebar's Notifications link. Its own
/// route so the app shell can ask on every page without loading the list.
export async function GET(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    const unread = await prisma.notification.count({ where: { recipientId: actor.id, isRead: false } });
    return NextResponse.json({ unread });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
