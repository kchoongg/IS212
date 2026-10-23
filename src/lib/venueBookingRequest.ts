// Request Venue Booking (SPM-42), in times since SPM-93: the coordinator gives
// a date, a start time and an end time on the 15-minute grid (#126, #128), and
// this turns them into the real start/end a VenueBooking stores.
//
// The stored window is the requested times only. Setup and turnaround are the
// venue's (Week 7 Customer Changes, Change #1) and are added by
// occupiedWindow() wherever availability is checked - storing them too would
// count them twice, and would go stale when Venue Staff change the venue's
// minutes.
//
// Pure functions over plain data, like the rest of src/lib.

import { formatDateTimeRange } from "@/lib/format";
import { CLOSED_EVENT_STATUSES_PHRASE, isBeforeApproval, isTerminalEventStatus } from "@/lib/statuses";
import { describeVenueConflict, findDuplicateRequest, findVenueConflict } from "@/lib/venueConflict";
import { type SearchBooking, type SearchableVenue } from "@/lib/venueSearch";
import {
  asClock,
  atLocalTime,
  isDayKey,
  isOnGrid,
  localDayKey,
  localMinuteOfDay,
  occupiedWindow,
  parseClock,
  widenToGrid,
  withinOpeningHours,
  type Interval,
  type Turnaround,
} from "@/lib/venueTime";
import { checkVenueSuitability, describeUnmet, type EventNeeds } from "@/lib/venueSuitability";

/// The requested times on `day` ("YYYY-MM-DD", Singapore), or null when the
/// date or either time cannot be read.
export function requestedWindow(day: string, startTime: string, endTime: string): Interval | null {
  if (!isDayKey(day) || parseClock(startTime) === null || parseClock(endTime) === null) return null;
  return { startsAt: atLocalTime(day, startTime), endsAt: atLocalTime(day, endTime) };
}

/// AC2: what the request form starts on - the schedule's own date and times
/// (a session's, for a multi-session event), widened to the 15-minute grid.
/// Null when the widened schedule runs over more than one day, or to midnight,
/// which one date and two time fields cannot hold.
export function defaultTimes(schedule: Interval): { day: string; startTime: string; endTime: string } | null {
  if (Number.isNaN(schedule.startsAt.getTime()) || Number.isNaN(schedule.endsAt.getTime())) return null;
  const widened = widenToGrid(schedule);
  const day = localDayKey(widened.startsAt);
  if (localDayKey(widened.endsAt) !== day) return null;
  return {
    day,
    startTime: asClock(localMinuteOfDay(widened.startsAt)),
    endTime: asClock(localMinuteOfDay(widened.endsAt)),
  };
}

/// AC3, worded for the field each one sits under.
export const REQUEST_TIME_MESSAGES = {
  startOffGrid: "Choose a start time on a 15-minute step (:00, :15, :30 or :45).",
  endOffGrid: "Choose an end time on a 15-minute step (:00, :15, :30 or :45).",
  endNotAfterStart: "The end time must be after the start time.",
} as const;

export type RequestTimeErrors = { startTime?: string; endTime?: string };

/// AC3: every reason the two times are refused, by field, so the form can show
/// each under its own field. Empty when both are fine. The server runs the same
/// check through checkVenueBookingRequest().
export function checkRequestTimes(times: { startTime: string; endTime: string }): RequestTimeErrors {
  const errors: RequestTimeErrors = {};
  if (!isOnGrid(times.startTime)) errors.startTime = REQUEST_TIME_MESSAGES.startOffGrid;
  if (!isOnGrid(times.endTime)) errors.endTime = REQUEST_TIME_MESSAGES.endOffGrid;
  if (!errors.startTime && !errors.endTime && parseClock(times.endTime)! <= parseClock(times.startTime)!) {
    errors.endTime = REQUEST_TIME_MESSAGES.endNotAfterStart;
  }
  return errors;
}

/// Does the request cover the whole of the event's (or, for a multi-session
/// event, the session's) own time? Wider is fine.
export function coversSchedule(requested: Interval, schedule: Interval): boolean {
  return (
    requested.startsAt.getTime() <= schedule.startsAt.getTime() &&
    requested.endsAt.getTime() >= schedule.endsAt.getTime()
  );
}

/// AC4: the refusal for a request whose room-in-use time does not fit the
/// venue's opening hours, with the earliest start and latest end that would.
export function openingHoursMessage(
  venue: Turnaround & { name: string; opensAt: string; closesAt: string }
): string {
  const opens = parseClock(venue.opensAt) ?? 0;
  const closes = parseClock(venue.closesAt) ?? 1440;
  const between = `choose times between ${asClock(opens + venue.setupMinutes)} and ${asClock(closes - venue.teardownMinutes)}.`;
  const open = `${venue.name} is open ${venue.opensAt}–${venue.closesAt}.`;
  return venue.setupMinutes === 0 && venue.teardownMinutes === 0
    ? `${open} ${between.charAt(0).toUpperCase()}${between.slice(1)}`
    : `${open} With its ${venue.setupMinutes} min setup and ${venue.teardownMinutes} min turnaround, ${between}`;
}

/// Same rule as recording equipment (SPM-47): a closed event takes no new requests.
export const CLOSED_EVENT_MESSAGE = `A venue cannot be requested for a ${CLOSED_EVENT_STATUSES_PHRASE} event.`;

/// SPM-54: arrangements wait for approval (isBeforeApproval, src/lib/statuses.ts).
export const NOT_APPROVED_MESSAGE = "A venue can be requested once this request has been approved.";

export interface BookingRequestInput {
  eventId: string;
  /// The session asked for; null for an event without sessions. No session of
  /// an event may ask for a room the event already holds at overlapping times
  /// (SPM-44 AC4, widened from the session to the event by SPM-81 AC4).
  sessionId: string | null;
  eventStatus: string;
  /// Who the request is for - the event, or one of its sessions.
  holder: { kind: "event" | "session"; name: string };
  /// The holder's own times.
  schedule: Interval;
  /// The attendance and layout of the space being asked for (SPM-90) - the
  /// session's or event's own unless the Coordinator set them; facilities are
  /// always the event's.
  needs: EventNeeds;
  venue: SearchableVenue;
  day: string;
  startTime: string;
  endTime: string;
}

export type BookingRequestCheck =
  | { ok: true; window: Interval }
  | { ok: false; error: string; field?: "startTime" | "endTime" };

/// Every rule a booking request must pass, checked in the order a coordinator
/// can fix them. Returns the window to store (the requested times only) or the
/// first reason it is refused - with the time field it belongs to, when it
/// belongs to one (AC3).
export function checkVenueBookingRequest(input: BookingRequestInput): BookingRequestCheck {
  const refuse = (error: string, field?: "startTime" | "endTime"): BookingRequestCheck =>
    field ? { ok: false, error, field } : { ok: false, error };
  const { venue, holder } = input;

  if (isTerminalEventStatus(input.eventStatus)) return refuse(CLOSED_EVENT_MESSAGE);
  if (isBeforeApproval(input.eventStatus)) return refuse(NOT_APPROVED_MESSAGE);

  const timeErrors = checkRequestTimes(input);
  if (timeErrors.startTime) return refuse(timeErrors.startTime, "startTime");
  if (timeErrors.endTime) return refuse(timeErrors.endTime, "endTime");
  const window = requestedWindow(input.day, input.startTime, input.endTime)!;

  if (!coversSchedule(window, input.schedule)) {
    const time = formatDateTimeRange(input.schedule.startsAt, input.schedule.endsAt);
    return refuse(`The requested times do not cover the ${holder.kind}'s time (${time}).`);
  }

  // AC4 and AC6: the room is in use for setup and turnaround too, and all of
  // it has to fall within the hours the venue is open.
  if (!withinOpeningHours(venue, occupiedWindow(window, venue))) return refuse(openingHoursMessage(venue));

  const { unmet } = checkVenueSuitability(input.needs, venue);
  if (unmet.length > 0) {
    return refuse(`${venue.name} is not suitable for this space: ${unmet.map(describeUnmet).join(" ")}`);
  }

  // SPM-44 AC4: the same request a second time. Checked before clashes with
  // other events, because "you have already asked" is the more useful answer.
  const duplicate = findDuplicateRequest(venue, window, { eventId: input.eventId, sessionId: input.sessionId });
  if (duplicate) {
    // SPM-81 AC4: another session of the event may be the one holding the
    // room. Naming the session that is asking would then be wrong, so the
    // refusal speaks for the event.
    const sameHolder = (duplicate.sessionId ?? null) === input.sessionId;
    return refuse(
      describeDuplicateRequest(sameHolder ? holder : { kind: "event", name: holder.name }, venue.name, duplicate)
    );
  }

  // #35, #41: a clash is blocked, not warned about. SPM-44 (AC9) also says
  // WHAT it clashes with, so the coordinator can go and look at that event or
  // period instead of guessing from an empty calendar. SPM-93 (AC6, AC7):
  // compared on occupied periods, setup and turnaround included.
  const conflict = findVenueConflict(venue, window, { eventId: input.eventId });
  if (conflict) return refuse(describeVenueConflict(venue.name, conflict));

  return { ok: true, window };
}

/// "This event already has a pending request for SPM44 Conflict Room on
/// 5 Apr 2027, 07:00–12:00." - the earlier request's own times, so the
/// coordinator can find it in the list below the form.
export function describeDuplicateRequest(
  holder: BookingRequestInput["holder"],
  venueName: string,
  existing: SearchBooking
): string {
  const who = holder.kind === "event" ? "This event" : holder.name;
  const what =
    existing.status === "approved"
      ? `already has ${venueName} booked`
      : `already has a pending request for ${venueName}`;
  return `${who} ${what} on ${formatDateTimeRange(existing.startsAt, existing.endsAt)}.`;
}

/// AC6 and AC8 as the screens show them: the times a request's setup and
/// turnaround take around it, and the whole room-in-use period - never stored.
export function setupAndTurnaround(
  window: Interval,
  venue: Turnaround
): { setup: Interval | null; turnaround: Interval | null; occupied: Interval } {
  const occupied = occupiedWindow(window, venue);
  return {
    setup: venue.setupMinutes > 0 ? { startsAt: occupied.startsAt, endsAt: window.startsAt } : null,
    turnaround: venue.teardownMinutes > 0 ? { startsAt: window.endsAt, endsAt: occupied.endsAt } : null,
    occupied,
  };
}
