// Shared by any domain (SCHEMA_REFERENCE.md: Notification has no single
// owner). Kept as a transaction helper, not a standalone write, so a
// notification is only ever created alongside the state change that caused
// it - never orphaned by a request that fails partway through.

import type { Prisma } from "@prisma/client";

/**
 * Notify every active user of a role about an event. Used where "the
 * relevant users" (briefing / story acceptance criteria) means "whoever
 * needs to act next", not a single person - e.g. no coordinator is assigned
 * yet when an event is first submitted, so the Ops Manager queue (S-28) is
 * who is notified.
 */
export async function notifyRole(
  tx: Prisma.TransactionClient,
  role: string,
  notification: { type: string; title: string; body: string; eventId?: string }
) {
  const recipients = await tx.user.findMany({
    where: { role, isActive: true },
    select: { id: true },
  });
  if (recipients.length === 0) return;

  await tx.notification.createMany({
    data: recipients.map((r) => ({
      recipientId: r.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      eventId: notification.eventId,
    })),
  });
}
