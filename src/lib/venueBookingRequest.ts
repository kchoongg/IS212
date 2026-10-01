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
import { statusLabel } from "@/lib/statuses";
import { occupancyConflict, type SearchableVenue } from "@/lib/venueSearch";
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

/// Only these event statuses may request a venue (team decision, 2026-10-01):
/// before approval there is nothing to plan; after confirmation the venue is
/// already settled (#80).
export const REQUESTABLE_EVENT_STATUSES = ["approved", "planning"];
export const NOT_REQUESTABLE_MESSAGE =
  "A venue booking can only be requested once the event is Approved or in Planning.";

export interface BookingRequestInput {
  eventId: string;
  eventStatus: string;
  /// Who the request is for - the event, or one of its sessions (AC4, AC5).
  holder: { kind: "event" | "session"; name: string };
  /// The holder's own times.
  schedule: Interval;
  /// The holder's existing pending or approved request, if any (#109).
  activeRequest: { venueName: string; status: string } | null;
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

  if (!REQUESTABLE_EVENT_STATUSES.includes(input.eventStatus)) {
    return refuse(NOT_REQUESTABLE_MESSAGE);
  }
  if (input.activeRequest) {
    const { venueName, status } = input.activeRequest;
    return refuse(`${holder.name} already has a venue booking request (${venueName}, ${statusLabel(status)}).`);
  }

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

  // #35, #41: a clash is blocked, not warned about.
  switch (occupancyConflict(venue, window, input.eventId)) {
    case "unavailable":
      return refuse(`${venue.name} is unavailable at this time.`);
    case "booked":
      return refuse(`${venue.name} is already booked for this time.`);
    case "on_hold":
      return refuse(`${venue.name} is on hold for another event at this time.`);
  }

  return { ok: true, window };
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
