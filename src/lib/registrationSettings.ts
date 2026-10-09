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

export type MeasuredBooking<T> =
  | { ok: true; booking: T }
  | { ok: false; field: "registrationCapacity" | "registrationVenueBookingId"; error: string };

/// AC4: which of the event's bookings the capacity is measured against. An
/// event can hold several active bookings (a multi-session event, or several
/// rooms at once - Week 7 change #3, SPM-81), and then the coordinator
/// chooses. `bookings` are the event's own, in any status: a chosen id that
/// is not among its active ones - rejected, cancelled, or another event's -
/// is refused. `savedId` is the one chosen on an earlier save, kept while it
/// is still active so changing only the capacity doesn't ask again.
export function measuredBooking<T extends { id: string; status: string }>(
  bookings: readonly T[],
  selectedId: string | undefined,
  savedId: string | null
): MeasuredBooking<T> {
  const live = liveBookings(bookings);
  if (live.length === 0) {
    return {
      ok: false,
      field: "registrationCapacity",
      error: "Book a venue for this event before setting a registration capacity.",
    };
  }

  if (selectedId !== undefined) {
    const chosen = live.find((b) => b.id === selectedId);
    return chosen
      ? { ok: true, booking: chosen }
      : { ok: false, field: "registrationVenueBookingId", error: "That venue booking isn't an active booking for this event." };
  }

  const saved = live.find((b) => b.id === savedId);
  if (saved) return { ok: true, booking: saved };
  if (live.length === 1) return { ok: true, booking: live[0] };
  return {
    ok: false,
    field: "registrationVenueBookingId",
    error: "Choose which venue booking the capacity is measured against.",
  };
}

/// Why `capacity` can't be saved against this booking, worded for the
/// 'Registration capacity' field, or null when it can.
export function capacityError(capacity: number, booking: BookingForCapacity): string | null {
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

export interface RegistrationPeriod {
  opensAt: Date | null;
  closesAt: Date | null;
}

/// AC5, AC6: the registration period, once the payload is applied to what is
/// saved (so changing only the closing date is still checked against the
/// saved opening date). Separate from the event's own date (#30), but it must
/// close no later than the event starts: closing exactly at the start is
/// allowed, as SPM-62's guard on moving the start already assumes. A period
/// that closes at or before it opens is no period at all. Field -> message,
/// empty when the period is allowed.
export function periodErrors(period: RegistrationPeriod, eventStartsAt: Date | null): Record<string, string> {
  const { opensAt, closesAt } = period;
  if (opensAt && closesAt && closesAt <= opensAt) {
    return { registrationClosesAt: "Registration closes at must be after it opens." };
  }
  if (closesAt && eventStartsAt && closesAt > eventStartsAt) {
    return { registrationClosesAt: "Registration must close no later than the event starts." };
  }
  return {};
}

/// AC7: the period can be extended or reopened (#42, #127) - moving the
/// closing date later, even once it has passed - but only until the event
/// starts. From then on any change to the dates is refused.
export function startedError(eventStartsAt: Date | null, now: Date): string | null {
  if (eventStartsAt && now >= eventStartsAt) {
    return "The event has started, so the registration period can't be changed.";
  }
  return null;
}
