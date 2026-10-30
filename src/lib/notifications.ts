// Shared by any domain (SCHEMA_REFERENCE.md: Notification has no single
// owner). Kept as a transaction helper, not a standalone write, so a
// notification is only ever created alongside the state change that caused
// it - never orphaned by a request that fails partway through.

import type { Prisma } from "@prisma/client";

/// What a notification says. Shared by both helpers below so the two cannot
/// drift apart in the fields they support.
export interface NotificationContent {
  type: string;
  title: string;
  body: string;
  eventId?: string;
}

/**
 * Notify one named person. The counterpart to notifyRole() below, for a story
 * whose acceptance criteria name an individual rather than a queue - e.g.
 * Manage Venue Catalogue (discussion board #120, #122): "the assigned
 * Coordinator is notified" is one specific person per affected booking, and
 * fanning that out to every coordinator would notify four people about a room
 * three of them are not responsible for.
 *
 * The caller resolves who that is. Event.coordinatorId is nullable, so
 * "assigned Coordinator" may not exist and only the caller knows what the
 * sensible fallback is for its own story.
 */
export async function notifyUser(
  tx: Prisma.TransactionClient,
  recipientId: string,
  notification: NotificationContent
) {
  await tx.notification.create({
    data: {
      recipientId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      eventId: notification.eventId,
    },
  });
}

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
  notification: NotificationContent
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

/// SPM-53 (AC14, AC15): what the organiser who owns the event is told when the
/// assigned Coordinator saves an important change - which of them changed, and
/// whether it took a Confirmed event back to Planning. Shared by the event
/// information change (SPM-62, SPM-32) and the equipment routes, where an
/// equipment change is the important change.
export async function notifyImportantChange(
  tx: Prisma.TransactionClient,
  event: { id: string; title: string | null; organiserId: string },
  changed: readonly string[],
  confirmationReverted: boolean
) {
  const title = event.title ?? "Untitled event";
  await notifyUser(tx, event.organiserId, {
    type: "event_information_changed",
    title: "Event information changed",
    body: `"${title}" has changed: ${changed.join(", ")}.`,
    eventId: event.id,
  });
  if (confirmationReverted) {
    await notifyUser(tx, event.organiserId, {
      type: "event_unconfirmed",
      title: "Event no longer confirmed",
      body: `"${title}" has moved back to Planning after a change and is no longer confirmed.`,
      eventId: event.id,
    });
  }
}
