// Expire Tentative Venue Hold (SPM-82): applies the rules in holdExpiry.ts to
// the database. There is no scheduled job (decided 2026-10-15): every route
// that reads venue bookings calls expireDueHolds() first, and so does the
// unread-notifications count, which every page asks for - so a hold is marked
// expired before anyone can read it as pending, and the Coordinator hears
// about it while anyone is using the app. Discussion #55: notifications have
// no hard real-time requirement.
//
// Each step is ONE statement that both changes the rows and returns the ones
// it changed (UPDATE ... RETURNING). Two requests sweeping at the same moment
// therefore never claim the same hold, and each Coordinator is told once.

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  holdExpiredNotification,
  holdExpiringNotification,
  warningHours,
  type HoldNoticeRow,
} from "@/lib/holdExpiry";
import type { NotificationContent } from "@/lib/notifications";

type Db = PrismaClient | Prisma.TransactionClient;

/// A hold the sweep changed, with who to tell: the event's assigned
/// Coordinator, or whoever made the request if it has none.
interface SweptHold extends HoldNoticeRow {
  id: string;
  recipientId: string;
}

/// Warn about holds expiring within the warning period (AC9), then expire the
/// ones whose time has passed (AC4). Warning first, and only for holds still in
/// the future, so a hold that ran out between two sweeps is expired, not warned.
export async function expireDueHolds(db: Db = prisma, now: Date = new Date()): Promise<{ warned: number; expired: number }> {
  const warnBy = new Date(now.getTime() + warningHours(process.env.VENUE_HOLD_WARNING_HOURS) * 3_600_000);

  const warned = (await db.$queryRaw<SweptHold[]>`
    UPDATE venue_bookings b SET expiry_warning_sent_at = ${now}
    FROM events e, venues v
    WHERE b.event_id = e.id AND b.venue_id = v.id
      AND b.status = 'pending' AND b.expiry_warning_sent_at IS NULL
      AND b.hold_expires_at > ${now} AND b.hold_expires_at <= ${warnBy}
    RETURNING b.id, b.event_id AS "eventId", COALESCE(e.coordinator_id, b.requested_by) AS "recipientId",
      e.title AS "eventTitle", v.name AS "venueName", v.code AS "venueCode", b.hold_expires_at AS "holdExpiresAt"
  `) ?? [];

  const expired = (await db.$queryRaw<SweptHold[]>`
    UPDATE venue_bookings b SET status = 'expired'
    FROM events e, venues v
    WHERE b.event_id = e.id AND b.venue_id = v.id
      AND b.status = 'pending' AND b.hold_expires_at <= ${now}
    RETURNING b.id, b.event_id AS "eventId", COALESCE(e.coordinator_id, b.requested_by) AS "recipientId",
      e.title AS "eventTitle", v.name AS "venueName", v.code AS "venueCode", b.hold_expires_at AS "holdExpiresAt"
  `) ?? [];

  const notices = [
    ...warned.map((row) => toNotification(row, holdExpiringNotification(row))),
    ...expired.map((row) => toNotification(row, holdExpiredNotification(row))),
  ];
  if (notices.length > 0) {
    await db.notification.createMany({ data: notices });
  }
  return { warned: warned.length, expired: expired.length };
}

function toNotification(row: SweptHold, content: NotificationContent) {
  return {
    recipientId: row.recipientId,
    type: content.type,
    title: content.title,
    body: content.body,
    eventId: content.eventId,
  };
}
