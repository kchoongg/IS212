// Request Venue Booking (SPM-42). Builds on src/lib/venueSlots.ts rather than
// defining slots again: the coordinator picks a day and one or more of its
// fixed slots, and this turns them into the real start/end a VenueBooking
// stores.
//
// The stored window is the event's OWN slots only. Setup and turnaround
// (AC3) are the venue's (#108, #123) and are added by occupiedCells(), the
// same rule the availability calendar uses - storing them too would make the
// calendar count them twice.
//
// Pure functions over plain data, like the rest of src/lib.

import { formatDate, formatDateTimeRange } from "@/lib/format";
import { isBeforeApproval, isTerminalEventStatus } from "@/lib/statuses";
import { describeVenueConflict, findDuplicateRequest, findVenueConflict } from "@/lib/venueConflict";
import { type SearchBooking, type SearchableVenue } from "@/lib/venueSearch";
import {
  SLOTS,
  SLOT_BOUNDARIES,
  localDayStart,
  occupiedCells,
  slotRangeLabel,
  slotsCovered,
  type Interval,
  type Slot,
  type SlotCell,
  type Turnaround,
} from "@/lib/venueSlots";
import { checkVenueSuitability, describeUnmet, type EventNeeds } from "@/lib/venueSuitability";

/// The start of the first chosen slot to the end of the last, on `day`
/// ("YYYY-MM-DD", Singapore). Null when no slot is chosen or the slots are not
/// contiguous - AM + Night would hold the room empty through PM.
export function requestedWindow(day: string, slots: readonly Slot[]): Interval | null {
  const chosen = SLOTS.filter((s) => slots.includes(s));
  if (chosen.length === 0) return null;
  const first = chosen[0];
  const last = chosen[chosen.length - 1];
  if (SLOTS.indexOf(last) - SLOTS.indexOf(first) + 1 !== chosen.length) return null;

  const dayStart = localDayStart(day).getTime();
  return {
    startsAt: new Date(dayStart + SLOT_BOUNDARIES[first].fromMinute * 60_000),
    endsAt: new Date(dayStart + SLOT_BOUNDARIES[last].toMinute * 60_000),
  };
}

/// Does the requested window hold every slot the event (or, for a
/// multi-session event, the session - AC4) actually runs in?
export function coversSchedule(requested: Interval, schedule: Interval): boolean {
  const held = new Set(slotsCovered(requested).map((c) => `${c.day}#${c.slot}`));
  return slotsCovered(schedule).every((c) => held.has(`${c.day}#${c.slot}`));
}

/// What the request form starts on: the schedule's own date and the slots it
/// touches (AC4 - a session's, not the event's). Null when the schedule runs
/// over more than one day, which a one-date request cannot cover.
export function defaultSlots(schedule: Interval): { day: string; slots: Slot[] } | null {
  const cells = slotsCovered(schedule);
  if (cells.length === 0 || cells.some((c) => c.day !== cells[0].day)) return null;
  return { day: cells[0].day, slots: cells.map((c) => c.slot) };
}

/// Same rule as recording equipment (SPM-47): a closed event takes no new requests.
export const CLOSED_EVENT_MESSAGE = "A venue cannot be requested for a completed, cancelled or rejected event.";

/// SPM-54: arrangements wait for approval (isBeforeApproval, src/lib/statuses.ts).
export const NOT_APPROVED_MESSAGE = "A venue can be requested once this request has been approved.";

export interface BookingRequestInput {
  eventId: string;
  /// The session asked for; null for an event without sessions. Two sessions
  /// may share a room, the same session may not ask twice (SPM-44 AC4).
  sessionId: string | null;
  eventStatus: string;
  /// Who the request is for - the event, or one of its sessions (AC4, AC5).
  holder: { kind: "event" | "session"; name: string };
  /// The holder's own times.
  schedule: Interval;
  /// Session attendance and layout where there is a session; facilities are
  /// always the event's.
  needs: EventNeeds;
  venue: SearchableVenue;
  day: string;
  slots: readonly Slot[];
}

export type BookingRequestCheck = { ok: true; window: Interval } | { ok: false; error: string };

/// Every rule a booking request must pass, checked in the order a coordinator
/// can fix them. Returns the window to store (the chosen slots only) or the
/// first reason it is refused.
export function checkVenueBookingRequest(input: BookingRequestInput): BookingRequestCheck {
  const refuse = (error: string): BookingRequestCheck => ({ ok: false, error });
  const { venue, holder } = input;

  if (isTerminalEventStatus(input.eventStatus)) return refuse(CLOSED_EVENT_MESSAGE);
  if (isBeforeApproval(input.eventStatus)) return refuse(NOT_APPROVED_MESSAGE);

  if (input.slots.length === 0) return refuse("Choose at least one slot.");
  const window = requestedWindow(input.day, input.slots);
  if (!window) {
    return refuse("Choose slots that are next to each other — AM and Night cannot be booked without PM.");
  }
  if (!coversSchedule(window, input.schedule)) {
    const time = formatDateTimeRange(input.schedule.startsAt, input.schedule.endsAt);
    return refuse(`The chosen slots do not cover the ${holder.kind}'s time (${time}).`);
  }

  const { unmet } = checkVenueSuitability(input.needs, venue);
  if (unmet.length > 0) {
    return refuse(`${venue.name} is not suitable for this event: ${unmet.map(describeUnmet).join(" ")}`);
  }

  // SPM-44 AC4: the same request a second time. Checked before clashes with
  // other events, because "you have already asked" is the more useful answer.
  const duplicate = findDuplicateRequest(venue, window, { eventId: input.eventId, sessionId: input.sessionId });
  if (duplicate) return refuse(describeDuplicateRequest(holder, venue.name, duplicate));

  // #35, #41: a clash is blocked, not warned about. SPM-44 (AC9) also says
  // WHAT it clashes with, so the coordinator can go and look at that event or
  // period instead of guessing from an empty calendar.
  const conflict = findVenueConflict(venue, window, { eventId: input.eventId });
  if (conflict) return refuse(describeVenueConflict(venue.name, conflict));

  return { ok: true, window };
}

/// "This event already has a pending request for SPM44 Conflict Room on
/// 5 Apr 2027 · AM (07:00–12:00)." - the earlier request's own slots, so the
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
  return `${who} ${what} on ${requestSlotsLabel(existing)}.`;
}

/// AC3 as the screens show it: the slot this request's setup takes before it
/// and its turnaround takes after, from occupiedCells() - never stored.
export function setupAndTurnaround(
  window: Interval,
  venue: Turnaround
): { setup: SlotCell | null; turnaround: SlotCell | null } {
  const cells = occupiedCells(window, venue);
  const first = cells[0];
  const last = cells[cells.length - 1];
  return {
    setup: first?.via === "turnaround" ? { day: first.day, slot: first.slot } : null,
    turnaround: cells.length > 1 && last.via === "turnaround" ? { day: last.day, slot: last.slot } : null,
  };
}

/// "7 Mar 2027 Night (19:00–24:00)"
export function slotCellLabel(cell: SlotCell): string {
  return `${formatDate(localDayStart(cell.day))} ${cell.slot} (${slotRangeLabel(cell.slot)})`;
}

/// "10 Mar 2027 · PM, Night (13:00–24:00)" - a request as its date and slots.
/// The raw end time would read "11 Mar 2027, 00:00" for anything ending with
/// Night. Falls back to the times for a booking that is not one day's slots.
export function requestSlotsLabel(window: Interval): string {
  const cells = slotsCovered(window);
  if (cells.length === 0 || cells.some((c) => c.day !== cells[0].day)) {
    return formatDateTimeRange(window.startsAt, window.endsAt);
  }
  const first = slotRangeLabel(cells[0].slot).split("–")[0];
  const last = slotRangeLabel(cells[cells.length - 1].slot).split("–")[1];
  return `${formatDate(localDayStart(cells[0].day))} · ${cells.map((c) => c.slot).join(", ")} (${first}–${last})`;
}
