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

import { SLOTS, SLOT_BOUNDARIES, localDayStart, slotsCovered, type Interval, type Slot } from "@/lib/venueSlots";

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
