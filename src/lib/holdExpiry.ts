// Expire Tentative Venue Hold (SPM-82, Week 7 change #4). A pending venue
// booking request is a tentative hold (discussion #41): it holds the room only
// until its expiry, and if Venue Staff have not approved it by then it expires
// and the room is free for other requests. An approved booking never expires.
//
// Pure rules, like the rest of src/lib. The sweep that applies them to the
// database - marking holds expired and notifying the Coordinator - is
// holdExpiryService.ts.

import { formatDateTime } from "@/lib/format";
import type { NotificationContent } from "@/lib/notifications";

/// AC2: how long a new hold lasts.
export const HOLD_DAYS = 7;

/// AC9: how long before expiry the Coordinator is warned, unless
/// VENUE_HOLD_WARNING_HOURS says otherwise (warningHours()).
export const DEFAULT_WARNING_HOURS = 24;

/// Approving, rejecting or re-timing a hold that has expired is refused in
/// these words wherever it is tried (AC5).
export const EXPIRED_HOLD_MESSAGE = "This hold has expired. The Coordinator must submit a new request.";

const DAY_MS = 86_400_000;

/// AC2: 7 days after the request, but never later than the start of the event.
export function defaultHoldExpiry(requestedAt: Date, eventStartsAt: Date | null): Date {
  const sevenDays = new Date(requestedAt.getTime() + HOLD_DAYS * DAY_MS);
  return eventStartsAt && eventStartsAt < sevenDays ? new Date(eventStartsAt) : sevenDays;
}

/// AC9 "configurable": hours from the setting, or the default for anything
/// that is not a positive finite number.
export function warningHours(raw: string | undefined): number {
  const hours = Number(raw);
  return raw && Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_WARNING_HOURS;
}

export type ExpiryChangeCheck = { ok: true } | { ok: false; error: string };

/// AC3: Venue Staff may move a hold's expiry while it is still active, to any
/// time from now up to the start of the event (AC2).
export function checkHoldExpiryChange(input: {
  status: string;
  newExpiry: Date;
  eventStartsAt: Date | null;
  now: Date;
}): ExpiryChangeCheck {
  const refuse = (error: string): ExpiryChangeCheck => ({ ok: false, error });
  if (input.status === "expired") return refuse(EXPIRED_HOLD_MESSAGE);
  if (input.status === "approved") return refuse("An approved booking does not expire.");
  if (input.status !== "pending") return refuse("Only a pending hold has an expiry to change.");
  if (input.newExpiry.getTime() <= input.now.getTime()) return refuse("The expiry must be in the future.");
  if (input.eventStartsAt && input.newExpiry > input.eventStartsAt) {
    return refuse(`The expiry cannot be later than the start of the event (${formatDateTime(input.eventStartsAt)}).`);
  }
  return { ok: true };
}

/// One hold the sweep acted on, as the notifications need it.
export interface HoldNoticeRow {
  eventId: string;
  eventTitle: string | null;
  venueName: string;
  venueCode: string;
  holdExpiresAt: Date;
}

const holdOn = (row: HoldNoticeRow) =>
  `The hold on ${row.venueName} (${row.venueCode}) for "${row.eventTitle ?? "Untitled event"}"`;

/// AC9: the warning, a configurable period before the hold expires.
export function holdExpiringNotification(row: HoldNoticeRow): NotificationContent {
  return {
    type: "venue_hold_expiring",
    title: "Venue hold expires soon",
    body: `${holdOn(row)} expires on ${formatDateTime(row.holdExpiresAt)}. Ask Venue Staff to approve it before then, or the venue will be released.`,
    eventId: row.eventId,
  };
}

/// AC9: the notice once it has expired.
export function holdExpiredNotification(row: HoldNoticeRow): NotificationContent {
  return {
    type: "venue_hold_expired",
    title: "Venue hold expired",
    body: `${holdOn(row)} expired on ${formatDateTime(row.holdExpiresAt)}, and the venue has been released. Submit a new request if you still need it.`,
    eventId: row.eventId,
  };
}

/// "2027-01-15T09:00" - a time as a datetime-local input wants it, in the
/// browser's own time zone, for Venue Staff's "New expiry" field.
export function toLocalInput(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}
