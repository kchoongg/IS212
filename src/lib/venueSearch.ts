// Search and filter venues against event requirements (SPM-40).
//
// The acceptance criteria this exists for - a coordinator can filter by:
//   AC1 date and time            -> isFreeFor(), withinOpeningHours()
//   AC2 expected attendance      -> fitsAttendance()
//   AC3 location                 -> building equality
//   AC4 accessibility            -> hasFacilities() (Facility.category "accessibility")
//   AC5 room layout              -> offersLayout()
//   AC6 required facilities      -> hasFacilities() (Facility.category "facility")
//   AC7 results ONLY show venues matching every selected criterion.
//
// AC7 is the difference from SPM-41. Suitability (src/lib/venueSuitability.ts)
// grades every venue and keeps the unsuitable ones on screen with a reason;
// this FILTERS, so a venue failing any selected criterion is simply not in the
// result. That split is the customer's, not ours - discussion #83: "search and
// filtering are mainly used to find or list potential venues, while
// suitability checking is used to assess a venue after it has been identified".
//
// Everything here is a PURE function over plain data - no Prisma, no
// NextRequest - like venueSuitability.ts and venueSlots.ts, so the rules can be
// tested without a database. src/app/api/venues/search/route.ts loads the rows
// and calls searchVenues().

import {
  dayNumberOf,
  localDayKey,
  localDayStart,
  localMinuteOfDay,
  occupiedWindow,
  parseClock,
  type Interval,
} from "@/lib/venueSlots";

/// What the coordinator asked for. Every field is optional: an absent filter
/// is not applied, so an empty filter set returns every active venue.
export interface VenueSearchFilters {
  /// When the room is needed. Both ends or neither - the schema enforces it.
  window?: Interval;
  attendance?: number;
  building?: string;
  layout?: string;
  /// Facility and accessibility ids alike - both are Facility rows, split only
  /// by `category`, so one list covers AC4 and AC6. The venue needs ALL of them.
  facilityIds?: readonly string[];
  /// The event being searched for, if any. Its own bookings never make a venue
  /// look taken - re-searching for an event that already holds MAR-GH must
  /// still offer MAR-GH.
  eventId?: string;
}

/// A booking row as the date filter needs it. Only `approved` and `pending`
/// ever take a room; anything else is ignored here even if a caller passes it.
export interface SearchBooking extends Interval {
  eventId: string;
  status: string;
}

export interface SearchBlock extends Interval {
  reason: string;
}

/// The parts of a venue the filters read. Structural rather than the Prisma
/// type so tests can use object literals.
export interface SearchableVenue {
  name: string;
  building: string;
  opensAt: string;
  closesAt: string;
  setupMinutes: number;
  teardownMinutes: number;
  layouts: readonly { layoutName: string; capacity: number }[];
  facilityIds: readonly string[];
  bookings: readonly SearchBooking[];
  unavailability: readonly SearchBlock[];
}

/// Which criterion a venue failed. Not shown to the coordinator (AC7 hides the
/// venue instead) - it exists so the tests can say WHY a venue was dropped, and
/// so the reason is one console.log away when someone asks "why isn't X there?".
export type Criterion =
  | "location"
  | "layout"
  | "capacity"
  | "facilities"
  | "opening_hours"
  | "booked"
  | "on_hold"
  | "unavailable";

// ---------------------------------------------------------------------------
// THE CRITERIA
// ---------------------------------------------------------------------------

/// AC5. A venue offers a layout when it has a VenueLayout row of that name -
/// the same test SPM-41 uses.
export function offersLayout(venue: Pick<SearchableVenue, "layouts">, layout: string): boolean {
  return venue.layouts.some((l) => l.layoutName === layout);
}

/// AC2. Capacity varies by layout (#112), so attendance is never compared with
/// Venue.maxCapacity:
///   - with a layout chosen, THAT layout must seat the attendance;
///   - without one, SOME layout must - the coordinator can pick it later.
/// A venue with no layouts at all therefore never passes a capacity filter,
/// which is what the /venues catalogue already warns Venue Staff about.
export function fitsAttendance(
  venue: Pick<SearchableVenue, "layouts">,
  attendance: number,
  layout?: string
): boolean {
  return venue.layouts.some(
    (l) => (layout == null || l.layoutName === layout) && l.capacity >= attendance
  );
}

/// AC4 and AC6. Every requested facility, not any of them.
export function hasFacilities(
  venue: Pick<SearchableVenue, "facilityIds">,
  facilityIds: readonly string[]
): boolean {
  return facilityIds.every((id) => venue.facilityIds.includes(id));
}

/// AC1, first half: the room must be open for the requested times (Venue Staff
/// maintain opening hours, #46; every day is the same, so there is no weekday
/// table to consult).
///
/// Checked on the wall clock in Singapore time (#36), the same zone the slot
/// grid uses: the start must be at or after opening on the first day, and the
/// end at or before closing on the last. A multi-day request is not checked
/// overnight - an event running 09:00 Monday to 18:00 Tuesday is two days of
/// use, not a claim on the room at 3am, and slot occupancy (isFreeFor) is what
/// guards the nights.
///
/// Unreadable hours pass rather than fail, the same stance as SPM-46's
/// openingHoursCoverage(): the venue form rejects bad values, so reaching this
/// means bad data, and hiding a real room because of it would be worse.
export function withinOpeningHours(
  venue: Pick<SearchableVenue, "opensAt" | "closesAt">,
  window: Interval
): boolean {
  const opens = parseClock(venue.opensAt);
  const closes = parseClock(venue.closesAt);
  if (opens == null || closes == null || closes <= opens) return true;

  const startMinute = localMinuteOfDay(window.startsAt);
  // An end at exactly midnight is the END of the previous day (24:00), not the
  // start of the next one at minute 0.
  const endsAtMidnight = localMinuteOfDay(window.endsAt) === 0;
  const endMinute = endsAtMidnight ? 1440 : localMinuteOfDay(window.endsAt);

  return startMinute >= opens && endMinute <= closes;
}

/// Half-open overlap - each starts before the other ends. The test used
/// everywhere in the venues domain (SCHEMA_REFERENCE.md), so back-to-back is
/// not a clash.
function overlapping(a: Interval, b: Interval): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && a.endsAt.getTime() > b.startsAt.getTime();
}

const NO_TURNAROUND = { setupMinutes: 0, teardownMinutes: 0 };

/// AC1, second half: is the room free? Returns the first reason it is not, or
/// null when it is.
///
/// The slot rules are the customer's and live in src/lib/venueSlots.ts
/// (SPM-46) - this module only asks them questions:
///   - a booking takes every slot its times touch, in full (#107), plus one
///     whole adjacent slot for setup and one for turnaround when the venue
///     needs them (#108, #123). occupiedWindow() is that rule as an interval.
///   - THE REQUESTED EVENT NEEDS THE SAME. Its own setup and turnaround slots
///     must be free too, so the requested window is widened exactly like an
///     existing booking's before comparing. Otherwise an AM search would offer
///     a room whose previous-night slot - where this event's setup goes - is
///     already somebody's turnaround.
///
/// What blocks, most serious first:
///   unavailable - a VenueUnavailability period (maintenance, renovation...)
///                 overlaps the requested window, setup and turnaround
///                 included: a room under renovation cannot be set up either.
///                 UI_DESIGN.md §7.4 says a blocked venue is excluded from S-14.
///   booked      - an APPROVED booking's occupied window overlaps.
///   on_hold     - a PENDING request's own slots overlap. #41: "only one active
///                 tentative hold or confirmed booking should exist for the
///                 same venue and overlapping time period", so a venue already
///                 on hold for that time cannot be requested - offering it
///                 would only lead to a refused request. A hold claims its own
///                 slots only, not setup/turnaround, the same as SPM-46's
///                 calendar shows it.
/// Rejected and cancelled requests never block.
export function occupancyConflict(
  venue: SearchableVenue,
  window: Interval,
  eventId?: string
): "unavailable" | "booked" | "on_hold" | null {
  const needed = occupiedWindow(window, venue);

  if (venue.unavailability.some((block) => overlapping(needed, block))) return "unavailable";

  const others = venue.bookings.filter((b) => eventId == null || b.eventId !== eventId);
  if (
    others.some((b) => b.status === "approved" && overlapping(needed, occupiedWindow(b, venue)))
  ) {
    return "booked";
  }
  if (
    others.some(
      (b) => b.status === "pending" && overlapping(needed, occupiedWindow(b, NO_TURNAROUND))
    )
  ) {
    return "on_hold";
  }
  return null;
}

/// Every criterion the venue fails, in the order the filters appear on screen.
/// Empty means the venue matches.
export function failedCriteria(venue: SearchableVenue, filters: VenueSearchFilters): Criterion[] {
  const failed: Criterion[] = [];

  if (filters.building != null && venue.building !== filters.building) failed.push("location");
  if (filters.layout != null && !offersLayout(venue, filters.layout)) failed.push("layout");
  // A missing layout already explains why nothing seats the attendance in it;
  // reporting capacity as well would name the same cause twice.
  else if (filters.attendance != null && !fitsAttendance(venue, filters.attendance, filters.layout)) {
    failed.push("capacity");
  }
  if (filters.facilityIds?.length && !hasFacilities(venue, filters.facilityIds)) {
    failed.push("facilities");
  }
  if (filters.window) {
    if (!withinOpeningHours(venue, filters.window)) failed.push("opening_hours");
    const conflict = occupancyConflict(venue, filters.window, filters.eventId);
    if (conflict) failed.push(conflict);
  }

  return failed;
}

/// AC7. Only the venues that pass every selected filter, by name.
///
/// When attendance is given, the smallest room that still fits comes first -
/// a 40-person workshop should see the 60-seat room before the 800-seat
/// expo floor. Ties, and searches without attendance, go by name.
export function searchVenues<V extends SearchableVenue>(
  venues: readonly V[],
  filters: VenueSearchFilters
): V[] {
  const matches = venues.filter((venue) => failedCriteria(venue, filters).length === 0);
  const { attendance, layout } = filters;
  if (attendance == null) return matches.sort((a, b) => a.name.localeCompare(b.name));

  const tightest = (venue: V) =>
    Math.min(
      ...venue.layouts
        .filter((l) => (layout == null || l.layoutName === layout) && l.capacity >= attendance)
        .map((l) => l.capacity)
    );
  return matches.sort((a, b) => tightest(a) - tightest(b) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// SINGAPORE WALL-CLOCK TIME
// ---------------------------------------------------------------------------
//
// The search sends "2026-12-09T09:00" - what the coordinator typed - and the
// server reads it as SINGAPORE time (#36: "we will be using Singapore time
// zone"), never the browser's or the server's. A coordinator on a laptop still
// set to London time must not search a different morning from the one they
// typed. The helpers below are the two directions of that conversion.

const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/// "2026-12-09T09:00" (Singapore) -> the instant. Null for anything malformed,
/// including impossible dates ("2026-02-31") and times ("25:00").
export function parseWallClock(value: string): Date | null {
  const match = WALL_CLOCK.exec(value);
  if (!match) return null;
  const [, day, hh, mm] = match;
  if (dayNumberOf(day) == null) return null;
  const hour = Number(hh);
  const minute = Number(mm);
  if (hour > 23 || minute > 59) return null;
  return new Date(localDayStart(day).getTime() + (hour * 60 + minute) * 60_000);
}

/// The instant -> "2026-12-09T09:00" in Singapore time, for pre-filling a
/// datetime-local input from an event's stored times.
export function toWallClock(instant: Date): string {
  const minute = localMinuteOfDay(instant);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${localDayKey(instant)}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}
