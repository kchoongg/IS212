// SPM-71 (View Notifications): how a notification is shown and where it leads.
// Pure, so the list route, the Notifications page and the app shell's unread
// count all read the same rules. Writing notifications is notifications.ts.

import { RESERVATION_NOTIFICATION_TYPES } from "@/lib/equipmentReservation";

/// Notification types about a venue booking that needs the coordinator's
/// review (SPM-39 venue changes, SPM-45 venue unavailability). The arrangement
/// is on the event's Venue tab, where its booking requests are listed.
/// SPM-82: a hold about to expire, or expired, is about the same booking list.
const VENUE_REVIEW_TYPES = [
  "booking_needs_review",
  "booking_venue_retired",
  "booking_venue_unavailable",
  "venue_hold_expiring",
  "venue_hold_expired",
];

/// Equipment that needs review (SPM-55 equipment out of service), or whose
/// reservation Technical Support released or changed (SPM-69). The
/// arrangement is on the event's Equipment tab.
const EQUIPMENT_REVIEW_TYPES = [
  "equipment_unavailable",
  RESERVATION_NOTIFICATION_TYPES.released,
  RESERVATION_NOTIFICATION_TYPES.adjusted,
];

/// Where selecting a notification goes (AC5): the arrangement it is about when
/// it is about one, otherwise the event's Overview - including any type this
/// list does not know yet, so a new kind of notification still leads
/// somewhere useful. Null when it is about no event. Whether the user may
/// still see that screen is the screen's own decision (AC6), exactly as when
/// they type its address.
export function notificationHref(type: string, eventReference: string | null): string | null {
  if (!eventReference) return null;
  const event = `/events/${eventReference}`;
  if (VENUE_REVIEW_TYPES.includes(type)) return `${event}/venue`;
  if (EQUIPMENT_REVIEW_TYPES.includes(type)) return `${event}/equipment`;
  return event;
}

/// The unread count as the navigation shows it (AC3): nothing at all for none,
/// and "99+" past 99 so the badge keeps its size.
export function unreadBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

/// Dispatched on `window` when the Notifications page marks something read, so
/// the app shell recounts without waiting for the next page change.
export const NOTIFICATIONS_CHANGED = "connectsphere:notifications-changed";

export function announceNotificationsChanged(): void {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
}
