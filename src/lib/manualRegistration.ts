// Manually Add Attendee (SPM-57): the assigned coordinator adds an Attendee
// account to an event's registration list on the organiser's behalf - "the
// attendee list will have to be provided to the Event Coordinator for
// processing" (customer clarification #33).
//
// AC2, AC3 (#99): "VIPs may be added manually even when normal registration is
// full, but the overall event/venue capacity must still not be exceeded." So
// the self-service limits (the registration period and capacity, SPM-51) do
// not apply, and the limit is the room: the layout capacity of the booking
// registration is measured against (SPM-64's measuredBooking()).
//
// PURE functions over plain data, like src/lib/registrationSettings.ts: the
// route (src/app/api/events/[id]/registrations/route.ts) loads the rows and
// calls these, and the Attendees tab shows what the route sends.

import { REGISTRATION_REFUSALS } from "./registrationEligibility";
import { measuredBooking, type BookingForCapacity } from "./registrationSettings";
import { layoutLabel } from "./venueSuitability";

export const ADD_ATTENDEE_MESSAGES = {
  notConfirmed: "Attendees can only be added to a Confirmed event.",
  disabled: REGISTRATION_REFUSALS.disabled,
  noAccount: "No Attendee account uses this email address. Only people with an Attendee account can be added.",
  capacityUnknown:
    "This event's venue capacity isn't known, so attendees can't be added. Choose the venue booking registration is measured against in the Registration settings first.",
};

export interface AddAttendeeEventFields {
  status: string;
  registrationEnabled: boolean;
}

/// Why attendees can't be added to this event now, or null when they can.
/// Confirmed only, as for self-registration (SPM-51 AC3): it is the only
/// status in which an attendee can open an event they hold a place in. The
/// registration period is deliberately not checked (#33: a list to process).
export function addAttendeeRefusal(event: AddAttendeeEventFields): string | null {
  if (event.status !== "confirmed") return ADD_ATTENDEE_MESSAGES.notConfirmed;
  if (!event.registrationEnabled) return ADD_ATTENDEE_MESSAGES.disabled;
  return null;
}

export interface VenueCapacity {
  capacity: number;
  /// "SPM57 Salon (SPM57-SAL)"
  venue: string;
  /// "Theatre"
  layout: string;
}

/// AC3: the room registration is measured against, and how many it seats in
/// its booked layout - null when that isn't known (no active booking, several
/// with none chosen, or one booked with no layout the room still offers).
export function venueCapacity(
  bookings: readonly BookingForCapacity[],
  measuredBookingId: string | null
): VenueCapacity | null {
  const measured = measuredBooking(bookings, undefined, measuredBookingId);
  if (!measured.ok) return null;
  const { booking } = measured;
  const layout = booking.venue.layouts.find((l) => l.layoutName === booking.layoutName);
  if (!layout) return null;
  return {
    capacity: layout.capacity,
    venue: `${booking.venue.name} (${booking.venue.code})`,
    layout: layoutLabel(layout.layoutName),
  };
}

/// What the Attendees tab says under the places line.
export function venueCapacityLine(venue: VenueCapacity): string {
  return `Venue capacity: ${venue.capacity} · ${venue.venue}, ${venue.layout} layout`;
}

/// AC3: refused once the seats taken - self-registered and manually added
/// together - reach the room's capacity.
export function venueFullError(venue: VenueCapacity, seatsTaken: number): string | null {
  if (seatsTaken < venue.capacity) return null;
  return `This event has reached its venue capacity: ${venue.capacity} attendees in ${venue.venue}, ${venue.layout} layout. No more attendees can be added.`;
}

/// An attendee who already holds a place is not added again. Taking someone
/// off the waiting list is Join and Respond to Waiting List (#26), not this.
/// A withdrawn registration is null: it is registered again, as
/// POST /api/registrations does (AC4).
export function alreadyHoldsPlace(name: string, status: string): string | null {
  if (status === "waitlisted") return `${name} is on the waiting list for this event.`;
  if (status === "registered" || status === "attended") return `${name} is already registered for this event.`;
  return null;
}

/// Shown once the attendee is added.
export function addedMessage(name: string): string {
  return `${name} has been added to the registration list.`;
}
