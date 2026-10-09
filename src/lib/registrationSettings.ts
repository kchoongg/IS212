// Configure Event Registration (SPM-64): the rules for an event's registration
// settings.
//
// PURE functions over plain data, like src/lib/venueSuitability.ts: the route
// (src/app/api/events/[id]/registration/route.ts) loads the rows and calls
// these, so the rules are tested without a database.
//
// The capacity is measured against the room the event has booked, in the
// layout it was booked for (VenueLayout.capacity) - capacity varies by layout
// and is given as a venue attribute (customer clarification #112). The room's
// maxCapacity is never a fallback, the same rule as checkVenueSuitability().

import { layoutLabel } from "@/lib/venueSuitability";

/// A pending booking is a question Venue Staff have not answered yet, but it
/// is the room the event is planned around, so registration can be set up
/// against it. Rejected and cancelled bookings hold nothing.
const LIVE_BOOKING_STATUSES = ["pending", "approved"];

export interface BookingForCapacity {
  id: string;
  status: string;
  /// What Venue Staff set up. Null when the event had no preferred layout.
  layoutName: string | null;
  venue: {
    name: string;
    code: string;
    layouts: readonly { layoutName: string; capacity: number }[];
  };
}

export function liveBookings<T extends { status: string }>(bookings: readonly T[]): T[] {
  return bookings.filter((b) => LIVE_BOOKING_STATUSES.includes(b.status));
}

/// Why `capacity` can't be saved against these live bookings, worded for the
/// 'Registration capacity' field, or null when it can.
export function capacityError(capacity: number, live: readonly BookingForCapacity[]): string | null {
  const booking = live[0];
  if (!booking) return "Book a venue for this event before setting a registration capacity.";

  // A layout the room no longer offers (removed in Manage Venue Catalogue,
  // SPM-39) leaves the capacity just as unknown as no layout at all.
  const layout = booking.venue.layouts.find((l) => l.layoutName === booking.layoutName);
  if (!booking.layoutName || !layout) {
    return "The venue booking has no room layout, so its capacity isn't known. Book the venue with a room layout first.";
  }

  if (capacity > layout.capacity) {
    const room = `${booking.venue.name} (${booking.venue.code})`;
    return `Registration capacity can't be more than ${layout.capacity}, the capacity of ${room} in its ${layoutLabel(layout.layoutName)} layout.`;
  }
  return null;
}
