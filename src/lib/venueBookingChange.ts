// Withdraw or Release Venue Booking (SPM-67). The assigned Coordinator takes
// back a venue the event no longer needs:
//
//   withdraw   a request Venue Staff have not decided yet (AC1). It leaves
//              their Booking Requests list, which shows Pending only (AC2).
//   release    a booking Venue Staff approved (AC3). Venue Staff are told
//              (AC7), since they had set the room aside.
//
// Either way the booking stays on the event as `withdrawn` or `released`
// (AC6), and holds nothing from then on: every availability, conflict,
// duplicate and confirmation rule counts only pending and approved bookings
// (src/lib/venueConflict.ts, src/lib/eventConfirmation.ts), so the period it
// occupied - setup and turnaround included - is free again (AC4) and the
// event's venue is outstanding until another is booked (AC8). Nothing else on
// the event changes: its status, and its other bookings (SPM-81 AC7).
//
// Who may do it is the route's question (canRequestVenueBooking - only the
// assigned Coordinator, AC9). Pure functions, like the rest of src/lib.

import type { NotificationContent } from "./notifications";
import { formatDateTimeRange, formatVenue } from "./format";
import { CLOSED_EVENT_STATUSES_PHRASE, isTerminalEventStatus } from "./statuses";

export type BookingChangeAction = "withdraw" | "release";

/// The status each action leaves the booking in.
const RESULT = { withdraw: "withdrawn", release: "released" } as const;
/// The status each action may start from.
const FROM = { withdraw: "pending", release: "approved" } as const;

export const ONLY_ASSIGNED_TO_CHANGE = "Only the assigned Coordinator can withdraw or release a venue booking.";
export const CLOSED_EVENT_CHANGE_MESSAGE = `Venue bookings cannot be changed on a ${CLOSED_EVENT_STATUSES_PHRASE} event.`;
/// Venue Staff approved it after the Coordinator's page loaded.
export const ALREADY_APPROVED_MESSAGE =
  "This request has already been approved, so it can no longer be withdrawn. Release the booking instead.";
export const NOT_APPROVED_YET_MESSAGE =
  "This request has not been approved yet, so there is nothing to release. Withdraw the request instead.";
export const NOT_WITHDRAWABLE_MESSAGE = "Only a pending request can be withdrawn.";
export const NOT_RELEASABLE_MESSAGE = "Only an approved booking can be released.";

export interface BookingChangeInput {
  action: BookingChangeAction;
  bookingStatus: string;
  eventStatus: string;
}

export type BookingChangeCheck =
  | { ok: true; status: (typeof RESULT)[BookingChangeAction] }
  | { ok: false; error: string };

/// May an event in this status have its bookings withdrawn or released? Not
/// once it is closed - the same events that take no new request
/// (CLOSED_EVENT_MESSAGE, src/lib/venueBookingRequest.ts). An event still
/// going ahead may, whatever its status, and keeps that status (decided
/// 2026-10-11, docs/test-cases/SPM-67_test_cases.json).
export function canChangeBookingsOf(eventStatus: string): boolean {
  return !isTerminalEventStatus(eventStatus);
}

export function checkBookingChange({ action, bookingStatus, eventStatus }: BookingChangeInput): BookingChangeCheck {
  if (!canChangeBookingsOf(eventStatus)) return { ok: false, error: CLOSED_EVENT_CHANGE_MESSAGE };

  if (bookingStatus !== FROM[action]) {
    // The two near misses get a message that says what to do instead.
    if (action === "withdraw" && bookingStatus === "approved") return { ok: false, error: ALREADY_APPROVED_MESSAGE };
    if (action === "release" && bookingStatus === "pending") return { ok: false, error: NOT_APPROVED_YET_MESSAGE };
    return { ok: false, error: action === "withdraw" ? NOT_WITHDRAWABLE_MESSAGE : NOT_RELEASABLE_MESSAGE };
  }

  return { ok: true, status: RESULT[action] };
}

export interface ReleaseNotificationInput {
  coordinatorName: string;
  venueName: string;
  venueCode: string;
  eventId: string;
  eventReference: string;
  eventTitle: string | null;
  sessionLabel: string | null;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
}

/// AC7: what Venue Staff are told when a booking is released.
///   "Daniel Tan released SPM67 Hall (SPM67-HAL) for EVT-000123 SPM67 Release
///    Pair on 4 Nov 2027, 09:00–12:00. Reason: Plenary moved."
export function releaseNotification(input: ReleaseNotificationInput): NotificationContent {
  const event = [input.eventReference, input.eventTitle].filter(Boolean).join(" ");
  const session = input.sessionLabel ? ` (${input.sessionLabel})` : "";
  const reason = input.reason ? ` Reason: ${input.reason}` : "";
  return {
    type: "venue_booking_released",
    title: "Venue booking released",
    body:
      `${input.coordinatorName} released ${formatVenue(input.venueName, input.venueCode)} for ${event}${session} ` +
      `on ${formatDateTimeRange(input.startsAt, input.endsAt)}.${reason}`,
    eventId: input.eventId,
  };
}
