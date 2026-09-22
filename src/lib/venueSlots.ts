// Which AM/PM/Night slots a booking or a maintenance block occupies.
//
// SPM-46 AC2: "Availability is shown per fixed slot (AM, PM, Night) for each
// day, including slots occupied by setup or turnaround time."
//
// Slots are DERIVED HERE FOR DISPLAY and never stored. That is deliberate: a
// `timeSlot` enum used to exist and was removed during the schema rebuild,
// because "'PM' cannot be checked against another booking" (the reasoning is
// recorded in src/lib/validation/events.ts). VenueBooking and
// VenueUnavailability keep real start/end timestamps, conflict detection keeps
// comparing real intervals, and this module turns those intervals into the
// cells of a grid at the last moment.
//
// Everything here is a PURE function over plain data - no Prisma, no
// NextRequest - for the same reason src/lib/permissions.ts and
// src/lib/venueImpact.ts are: the rules are the part worth testing, and they
// should be testable without a database.

import { TIME_ZONE } from "@/lib/format";

// ---------------------------------------------------------------------------
// SLOT BOUNDARIES — PROVISIONAL, pending confirmation on SPM-46
// ---------------------------------------------------------------------------
//
// ⚠️ These times are a WORKING ASSUMPTION, not a confirmed requirement.
//
// SPM-46 names the three slots but never defines their boundaries, and nothing
// else in the project does either: UI_DESIGN.md never mentions slots, and the
// S-21 mockup (design/mockups/VenueCalendar.dc.html) draws a continuous time
// grid instead. Asked on SPM-46 (comment, 2026-09-21); still awaiting Kristen's
// confirmation, so these may yet change.
//
// The grid is FIXED - the same for every venue. A venue's own opening hours do
// not move the boundaries; they only mark a slot "partial" or "closed" (see
// openingHoursCoverage). Per-venue boundaries were considered and rejected: a
// fixed grid keeps venues comparable, and nothing defines where PM would start
// if AM started at each venue's opening time.
//
// AM starts at 06:00, moved from the originally proposed 08:00 (2026-09-22).
// 08:00 was measured against the seeded data and found too late: four of
// thirteen approved bookings fell partly before AM began once setup time was
// added - Jurong Expo Floor opens at 06:00, and Marina Grand Hall's 180-minute
// setup puts a 09:00 event in the room from 06:00. With AM at 06:00 all four
// are fully covered. PM and Night are unchanged.
//
// This table is the single source of truth - every function below derives from
// it, so different numbers are a change HERE and nowhere else. Two answers
// would need more than new numbers, and both are called out where they bite:
//   - a slot that runs past midnight (see slotsCovered)
//   - widening the grid to cover the whole day (see minutesOutsideSlots)

export const SLOTS = ["AM", "PM", "Night"] as const;

export type Slot = (typeof SLOTS)[number];

/// Minutes from local midnight, half-open: [fromMinute, toMinute). A booking
/// that starts exactly at 12:00 is PM, not the tail of AM.
export const SLOT_BOUNDARIES: Record<Slot, { fromMinute: number; toMinute: number }> = {
  AM: { fromMinute: 6 * 60, toMinute: 12 * 60 }, // 06:00–12:00 (was 08:00 - see above)
  PM: { fromMinute: 12 * 60, toMinute: 18 * 60 }, // 12:00–18:00
  Night: { fromMinute: 18 * 60, toMinute: 23 * 60 }, // 18:00–23:00
};

/// "06:00–12:00", for a column header. Derived, never written out by hand, so
/// a boundary change cannot leave a stale label behind.
export function slotRangeLabel(slot: Slot): string {
  const { fromMinute, toMinute } = SLOT_BOUNDARIES[slot];
  return `${asClock(fromMinute)}–${asClock(toMinute)}`;
}

function asClock(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// LOCAL TIME
// ---------------------------------------------------------------------------
//
// Bookings are stored as instants; slot boundaries are wall-clock times. The
// two only meet in a timezone, and the project already has one: format.ts
// displays everything in Asia/Singapore ("Singapore time throughout release
// 1"), so bucketing in any other zone would put a booking in a different slot
// from the one its own printed time implies.
//
// Deliberately NOT the same question as the deferred opening-hours check
// (`Venue.opensAt` vs a booking's timestamp). That one compares two stored
// values and needs a decision about what the stored text means. This one only
// has to agree with what is on screen.

const LOCAL_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  // h23 rather than hour12:false: some ICU builds report midnight as hour 24
  // under hour12:false, which would roll a 00:15 booking into the wrong day.
  hourCycle: "h23",
});

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function localParts(instant: Date): LocalParts {
  const parts = LOCAL_PARTS.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

/// The local calendar day an instant falls on, as "YYYY-MM-DD". This is the
/// column a cell belongs to, and the key a grid is built on.
export function localDayKey(instant: Date): string {
  const { year, month, day } = localParts(instant);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/// Minutes since local midnight, 0–1439.
export function localMinuteOfDay(instant: Date): number {
  const { hour, minute } = localParts(instant);
  return hour * 60 + minute;
}

/// Minutes since the epoch *in local terms* - local day number × 1440 plus the
/// minute of that day.
///
/// This is what lets the rest of the module be plain integer arithmetic. Every
/// comparison happens in one flat local-minute space, so nothing has to
/// reconstruct an instant from a wall-clock boundary, and a slot on one day can
/// be compared with an interval that started on another.
function localAbsoluteMinute(instant: Date): number {
  const { year, month, day, hour, minute } = localParts(instant);
  const dayNumber = Date.UTC(year, month - 1, day) / 86_400_000;
  return dayNumber * 1440 + hour * 60 + minute;
}

function dayKeyFromDayNumber(dayNumber: number): string {
  return new Date(dayNumber * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// THE TWO RULES
// ---------------------------------------------------------------------------

export interface Interval {
  startsAt: Date;
  endsAt: Date;
}

/// The turnaround fields of a Venue. Structural rather than the Prisma type so
/// these functions can be tested with object literals.
export interface Turnaround {
  setupMinutes: number;
  teardownMinutes: number;
}

/// How long the room is ACTUALLY occupied by a booking: its published times
/// widened by the venue's setup and teardown.
///
/// This is the whole of AC2's "including slots occupied by setup or turnaround
/// time". Nothing else in the codebase has ever read setupMinutes /
/// teardownMinutes - until now they were recorded on the venue form and never
/// used - so this is the first place the numbers mean anything.
///
/// Note the buffers belong to the VENUE, not the booking: the same event in a
/// room with a 240-minute setup occupies far more of the day than in one with
/// 20. Jurong Expo Floor is 240/180 in the seed; Orchard Studio is 20/15.
export function occupiedWindow(booking: Interval, venue: Turnaround): Interval {
  return {
    startsAt: new Date(booking.startsAt.getTime() - venue.setupMinutes * 60_000),
    endsAt: new Date(booking.endsAt.getTime() + venue.teardownMinutes * 60_000),
  };
}

export interface SlotCell {
  /// Local calendar day, "YYYY-MM-DD".
  day: string;
  slot: Slot;
}

/// A guard against a pathological input looping for ever. A maintenance block
/// spanning more than a year is a data error, not a calendar to render; the
/// caller should be clamping to the window it asked for anyway.
const MAX_SPAN_DAYS = 366;

/// Which day+slot cells an interval touches.
///
/// The interval is half-open: a booking ending exactly at 12:00 does not touch
/// PM. Same overlap test as everywhere else in the venues domain - each starts
/// before the other ends (SCHEMA_REFERENCE.md, "the overlap test, which you
/// need in three of these").
///
/// An interval spanning midnight simply produces cells on both days, because
/// the slots themselves never cross midnight. If Night is ever moved past
/// midnight, this is where that breaks: a slot would then belong to two
/// calendar days at once and `day` would stop being a single value.
export function slotsCovered(interval: Interval): SlotCell[] {
  const from = localAbsoluteMinute(interval.startsAt);
  const to = localAbsoluteMinute(interval.endsAt);

  // Zero-length and inverted intervals touch nothing. An inverted one is a
  // data error, but returning [] beats rendering a backwards booking.
  if (to <= from) return [];

  const firstDay = Math.floor(from / 1440);
  const lastDay = Math.floor((to - 1) / 1440); // -1: an interval ending at
  // exactly midnight belongs to the day before, not to a new empty day.
  const cappedLastDay = Math.min(lastDay, firstDay + MAX_SPAN_DAYS - 1);

  const cells: SlotCell[] = [];
  for (let dayNumber = firstDay; dayNumber <= cappedLastDay; dayNumber++) {
    const dayStart = dayNumber * 1440;
    for (const slot of SLOTS) {
      const { fromMinute, toMinute } = SLOT_BOUNDARIES[slot];
      const slotFrom = dayStart + fromMinute;
      const slotTo = dayStart + toMinute;
      if (from < slotTo && to > slotFrom) {
        cells.push({ day: dayKeyFromDayNumber(dayNumber), slot });
      }
    }
  }
  return cells;
}

/// How much of an interval falls in no slot at all.
///
/// The slots do not cover the whole day: with the provisional boundaries,
/// 23:00–06:00 belongs to nothing. A booking inside that window would produce
/// ZERO cells from slotsCovered() and vanish from the grid entirely.
///
/// This function is how the AM boundary was fixed. With AM at 08:00, four of
/// the thirteen seeded approved bookings reported up to 120 minutes outside
/// the grid once setup was added (2026-09-21). Moving AM to 06:00 brought all
/// four to 0 (2026-09-22). Nothing in the seed reaches before 06:00 or after
/// 23:00 today - but no rule stops a venue opening at 05:00, so keep the check.
///
/// Callers should surface a non-zero result rather than silently dropping the
/// booking. If the grid is ever widened to cover the full day, this returns 0
/// everywhere and the warning quietly stops firing.
export function minutesOutsideSlots(interval: Interval): number {
  const from = localAbsoluteMinute(interval.startsAt);
  const to = localAbsoluteMinute(interval.endsAt);
  if (to <= from) return 0;

  const firstDay = Math.floor(from / 1440);
  const lastDay = Math.floor((to - 1) / 1440);
  const cappedLastDay = Math.min(lastDay, firstDay + MAX_SPAN_DAYS - 1);

  let covered = 0;
  for (let dayNumber = firstDay; dayNumber <= cappedLastDay; dayNumber++) {
    const dayStart = dayNumber * 1440;
    for (const slot of SLOTS) {
      const { fromMinute, toMinute } = SLOT_BOUNDARIES[slot];
      const overlapFrom = Math.max(from, dayStart + fromMinute);
      const overlapTo = Math.min(to, dayStart + toMinute);
      if (overlapTo > overlapFrom) covered += overlapTo - overlapFrom;
    }
  }
  return Math.max(0, to - from - covered);
}

// ---------------------------------------------------------------------------
// CALENDAR DAYS
// ---------------------------------------------------------------------------
//
// The availability endpoint takes its range as local calendar days
// ("2026-09-28"), because that is what a person picks. These turn a day key
// into the instants a database query needs, and walk a range day by day.

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/// "2026-09-28" -> its day number, or null when it is not a real calendar date.
/// Checked by round-tripping, so "2026-02-31" is rejected rather than quietly
/// becoming 3 March.
export function dayNumberOf(dayKey: string): number | null {
  const match = DAY_KEY.exec(dayKey);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return ms / 86_400_000;
}

export function isDayKey(value: string): boolean {
  return dayNumberOf(value) !== null;
}

/// Assumes a valid day key - validate at the boundary with isDayKey().
export function addDays(dayKey: string, days: number): string {
  return dayKeyFromDayNumber((dayNumberOf(dayKey) ?? 0) + days);
}

/// Every day from `from` to `to`, both included. Empty when to < from.
export function dayRange(from: string, to: string): string[] {
  const first = dayNumberOf(from);
  const last = dayNumberOf(to);
  if (first === null || last === null || last < first) return [];
  const days: string[] = [];
  for (let n = first; n <= last; n++) days.push(dayKeyFromDayNumber(n));
  return days;
}

/// The instant a local day begins - local midnight - for querying stored
/// timestamps. Derives the zone's offset rather than hard-coding +08:00, so it
/// stays right if TIME_ZONE ever changes. (Exact for a fixed-offset zone like
/// Singapore's; a zone with daylight saving could be an hour out on the
/// changeover day itself.)
export function localDayStart(dayKey: string): Date {
  const dayNumber = dayNumberOf(dayKey) ?? 0;
  const utcMidnight = dayNumber * 86_400_000;
  const offsetMinutes = localAbsoluteMinute(new Date(utcMidnight)) - dayNumber * 1440;
  return new Date(utcMidnight - offsetMinutes * 60_000);
}

// ---------------------------------------------------------------------------
// OPENING HOURS WITHIN A SLOT
// ---------------------------------------------------------------------------
//
// The slot grid is the same for every venue (see SLOT_BOUNDARIES). A venue's
// own opening hours do not move the boundaries - they say whether the room can
// be used in a slot at all. Jurong Expo Floor opening 06:00 and Orchard Studio
// closing 21:00 both show all three slots; the second one's Night is "partial".
//
// Both sides of this comparison are wall-clock "HH:MM" text, so unlike the
// deferred opening-hours *impact* check (which compares Venue.opensAt against a
// booking's stored timestamp) no timezone question arises here.

export type OpeningHoursCoverage = "full" | "partial" | "closed";

/// "08:30" -> 510. Null for anything that is not a valid 24-hour time.
export function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/// How much of a slot the venue is open for.
///
/// Unreadable or inverted hours report "full" rather than "closed": the venue
/// form rejects both, so reaching this means bad data, and inventing a closure
/// from data that cannot be read would hide real availability.
export function openingHoursCoverage(
  slot: Slot,
  opensAt: string,
  closesAt: string
): OpeningHoursCoverage {
  const open = parseClock(opensAt);
  const close = parseClock(closesAt);
  if (open === null || close === null || close <= open) return "full";

  const { fromMinute, toMinute } = SLOT_BOUNDARIES[slot];
  const overlap = Math.min(close, toMinute) - Math.max(open, fromMinute);
  if (overlap <= 0) return "closed";
  if (open <= fromMinute && close >= toMinute) return "full";
  return "partial";
}
