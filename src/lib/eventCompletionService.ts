// Mark Event as Completed (SPM-36, AC6): applies the 7-day rule in
// eventCompletion.ts to the database. Like SPM-82's hold expiry, there is no
// scheduled job (decided 2026-10-22): the routes that read events - the event
// itself, the events list, the Assignments screen - and the unread-
// notifications count, which every page asks for, call completeDueEvents()
// first. So an event is completed before anyone can read it as still
// Confirmed.
//
// ONE statement both changes the rows and returns the ones it changed
// (UPDATE ... RETURNING), so two requests sweeping at the same moment never
// complete the same event twice, and each gets one history entry.

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AUTO_COMPLETE_REASON, autoCompleteCutoff } from "@/lib/eventCompletion";

type Db = PrismaClient | Prisma.TransactionClient;

/// Completes every Confirmed event that ended 7 or more days ago, recording
/// each in the status history with no user and telling its organiser
/// (SPM-53, AC18). Returns how many it completed.
export async function completeDueEvents(db: Db = prisma, now: Date = new Date()): Promise<number> {
  const completed = (await db.$queryRaw<{ id: string; title: string | null; organiser_id: string }[]>`
    UPDATE events SET status = 'completed', updated_at = ${now}
    WHERE status = 'confirmed' AND ends_at <= ${autoCompleteCutoff(now)}
    RETURNING id, title, organiser_id
  `) ?? [];

  if (completed.length > 0) {
    await db.eventStatusHistory.createMany({
      data: completed.map(({ id }) => ({
        eventId: id,
        fromStatus: "confirmed",
        toStatus: "completed",
        changedBy: null,
        changedAt: now,
        reason: AUTO_COMPLETE_REASON,
      })),
    });
    await db.notification.createMany({
      data: completed.map(({ id, title, organiser_id }) => ({
        recipientId: organiser_id,
        type: "event_completed",
        title: "Event completed",
        body: `"${title ?? "Untitled event"}" has been marked completed.`,
        eventId: id,
      })),
    });
  }
  return completed.length;
}
