import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActor, unauthenticated } from "@/lib/apiAuth";

/// SPM-71 (AC4): mark every one of the caller's unread notifications as read,
/// and say how many that was. Scoped to the caller (AC7).
export async function POST(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    const { count } = await prisma.notification.updateMany({
      where: { recipientId: actor.id, isRead: false },
      data: { isRead: true },
    });
    return NextResponse.json({ updated: count });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
