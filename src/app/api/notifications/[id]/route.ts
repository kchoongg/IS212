import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { getActor, unauthenticated } from "@/lib/apiAuth";
import { markNotificationSchema } from "@/lib/validation";

/// SPM-71 (AC4): mark one of the caller's notifications as read. Ownership is
/// the update's own where clause, so someone else's notification is never
/// touched - it simply does not match, and the answer is 404 rather than 403,
/// which would confirm it exists (AC7).
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const actor = await getActor(req);
    if (!actor) {
      return unauthenticated();
    }
    markNotificationSchema.parse(await req.json());

    const { count } = await prisma.notification.updateMany({
      where: { id, recipientId: actor.id },
      data: { isRead: true },
    });
    if (count === 0) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }
    return NextResponse.json({ id, isRead: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
