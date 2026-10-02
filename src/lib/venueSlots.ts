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
// SLOT BOUNDARIES — set by the customer, clarification #50 (2026-08-25)
// ---------------------------------------------------------------------------
//
// "The venue will be booked based on 3 time slots (AM, PM, Night); if full day
// will be all 3 slots. AM (7am-12pm, 1pm-6pm, 7pm-12am)."
//
// So: AM 07:00-12:00, PM 13:00-18:00, Night 19:00-24:00. These are NOT ours to
// choose - an earlier version of this file set its own grid (06:00-12:00 /
// 12:00-18:00 / 18:00-23:00) and said "nothing else in the project defines
// them", which was simply wrong. Change them only if the customer does.
//
// The hours BETWEEN slots - 12:00-13:00, 18:00-19:00 and 24:00-07:00 - belong
// to no slot on purpose. They are changeover time, and nothing is lost by them:
// a booking that runs through one still consumes the slots on either side of
// it (#107, below), and the setup/turnaround rule claims the adjacent slot
// anyway (#123, see adjacentSlot).
//
// The grid is FIXED - the same for every venue. A venue's own opening hours do
// not move the boundaries; they only mark a slot "partial" or "closed" (see
// openingHoursCoverage). Per-venue boundaries were considered and rejected: a
// fixed grid keeps venues comparable, and nothing defines where PM would start
// if AM started at each venue's opening time.
//
// Night ends AT midnight rather than crossing it, so the caveat below about a
// slot running past midnight still does not apply.
//
// This table is the single source of truth - every function below derives from
// it, so different numbers are a change HERE and nowhere else. Two kinds of
// change would need more than new numbers, and both are called out where they
// bite:
//   - a slot that runs past midnight (see slotsCovered)
//   - widening the grid to cover the whole day (see minutesOutsideSlots)

export const SLOTS = ["AM", "PM", "Night"] as const;

export type Slot = (typeof SLOTS)[number];

/// Minutes from local midnight, half-open: [fromMinute, toMinute). A booking
/// that starts exactly at 12:00 is PM, not the tail of AM.
export const SLOT_BOUNDARIES: Record<Slot, { fromMinute: number; toMinute: number }> = {
  AM: { fromMinute: 7 * 60, toMinute: 12 * 60 }, // 07:00–12:00
  PM: { fromMinute: 13 * 60, toMinute: 18 * 60 }, // 13:00–18:00
  Night: { fromMinute: 19 * 60, toMinute: 24 * 60 }, // 19:00–24:00
};

/// "07:00–12:00", for a column header. Derived, never written out by hand, so
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

/// The slot immediately before or after a given cell, wrapping across days.
///
/// "Setup and turnaround use the immediately adjacent booking slot, including
/// across days" (#123, 2026-09-14). So the slot before AM is the PREVIOUS
/// day's Night, and the slot after Night is the NEXT day's AM.
export function adjacentSlot(cell: SlotCell, direction: -1 | 1): SlotCell {
  const index = SLOTS.indexOf(cell.slot) + direction;
  if (index < 0) return { day: addDays(cell.day, -1), slot: SLOTS[SLOTS.length - 1] };
  if (index >= SLOTS.length) return { day: addDays(cell.day, 1), slot: SLOTS[0] };
  return { day: cell.day, slot: SLOTS[index] };
}

/// Every cell a booking takes out of circulation: the slots its own times
/// touch, plus one slot of setup before and one of turnaround after.
///
/// This is AC2's "including slots occupied by setup or turnaround time", and
/// the shape of it comes from the customer, not from us:
///
///   #107 (2026-09-07) - an event running across two slots "consumes both
///         slots in full". Touching any part of a slot takes the whole slot;
///         that is already how slotsCovered() works.
///   #108 (2026-09-07) - "one slot will be treated as the smallest unit for
///         setup and turnaround time ... does not need to support setup or
///         turnaround durations smaller than a slot".
///   #123 (2026-09-14) - each takes "at most one full slot", on the
///         immediately adjacent slot, across days where needed.
///
/// So Venue.setupMinutes / teardownMinutes are read as a YES/NO here, not as a
/// duration: any non-zero value costs exactly one whole adjacent slot, whether
/// it is 20 minutes or 240. Venue Staff still record the real minutes on the
/// venue form - that is what #43 asks them to maintain - and this is the only
/// place that reinterprets them.
///
/// An earlier version widened the booking by those minutes instead and derived
/// cells from the result. That could not express either half of #123: setup
/// reached an earlier slot only when the minutes happened to span it, and it
/// could never reach the previous day at all.
export function occupiedCells(booking: Interval, venue: Turnaround): OccupiedCell[] {
  const own = slotsCovered(booking);
  if (own.length === 0) return [];

  const cells: OccupiedCell[] = own.map((cell) => ({ ...cell, via: "booking" as const }));
  const seen = new Set(own.map(key));

  const add = (cell: SlotCell) => {
    if (seen.has(key(cell))) return; // a booking already holding it wins
    seen.add(key(cell));
    cells.push({ ...cell, via: "turnaround" });
  };
  if (venue.setupMinutes > 0) add(adjacentSlot(own[0], -1));
  if (venue.teardownMinutes > 0) add(adjacentSlot(own[own.length - 1], 1));

  return cells.sort((a, b) => key(a).localeCompare(key(b)));
}

/// A cell, and why the booking holds it.
export interface OccupiedCell extends SlotCell {
  via: "booking" | "turnaround";
}

const key = (cell: SlotCell): string =>
  `${cell.day}#${SLOTS.indexOf(cell.slot)}`;

/// The wall-clock window a booking takes the room out of circulation for: the
/// start of its first occupied slot to the end of its last. Shown as "Room in
/// use"; it can span days, because setup and turnaround can.
///
/// Returns the booking's own times unchanged when it touches no slot at all -
/// see minutesOutsideSlots(), which is how that case gets surfaced.
export function occupiedWindow(booking: Interval, venue: Turnaround): Interval {
  const cells = occupiedCells(booking, venue);
  if (cells.length === 0) return booking;

  const first = cells[0];
  const last = cells[cells.length - 1];
  return {
    startsAt: slotStart(first),
    endsAt: slotStart(last, "end"),
  };
}

function slotStart(cell: SlotCell, edge: "start" | "end" = "start"): Date {
  const { fromMinute, toMinute } = SLOT_BOUNDARIES[cell.slot];
  const minutes = edge === "start" ? fromMinute : toMinute;
  return new Date(localDayStart(cell.day).getTime() + minutes * 60_000);
}

/// Half-open overlap - each starts before the other ends. The test used
/// everywhere in the venues domain (SCHEMA_REFERENCE.md), so back-to-back is
/// not a clash. Lived in venueSearch.ts until SPM-44 needed it in two modules.
export function overlapping(a: Interval, b: Interval): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && a.endsAt.getTime() > b.startsAt.getTime();
}

/// A venue that needs no preparation time, for reading a window as its own
/// slots only - what a pending request holds (#41).
export const NO_TURNAROUND: Turnaround = { setupMinutes: 0, teardownMinutes: 0 };

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
/// The slots deliberately do not cover the whole day: 12:00-13:00, 18:00-19:00
/// and 24:00-07:00 belong to nothing (#50). Most of that is harmless - an event
/// running 09:00-17:00 crosses the lunch gap but still holds AM and PM in full,
/// so the grid shows the room as taken on both sides and nothing is hidden.
///
/// The case that matters is a booking which touches NO slot - 12:15-12:45, say,
/// or 01:00-05:00. That produces zero cells from slotsCovered() and vanishes
/// from the grid entirely. Callers should surface THAT rather than every minute
/// of changeover time; see hiddenMinutes(), which is what the calendar reports.
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

/// The minutes of a booking the grid genuinely cannot show: its whole duration
/// when it touches no slot, and zero otherwise.
///
/// Splitting this from minutesOutsideSlots() keeps that function honest - it
/// still answers exactly what it says - while giving the screen the one signal
/// worth a warning. Before the slots were corrected to the customer's (#50) the
/// two were the same thing, because the old grid had no interior gaps.
export function hiddenMinutes(interval: Interval): number {
  return slotsCovered(interval).length === 0 ? minutesOutsideSlots(interval) : 0;
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

/// The note a partly-open slot carries, e.g. "Open from 08:00" - null when the
/// venue is open for the whole slot, or shut for all of it.
///
/// This says WHICH hours rather than just "Limited hours", because with AM
/// starting at 06:00 a generic note fires on 14 of the 16 seeded venues: only
/// Jurong Expo Floor opens that early. A label on almost every cell carries no
/// information, and worse, it made One-North Rooftop Terrace - open 16:00, so
/// barely usable in PM - look the same as a room that opens at 08:00 and is
/// fine. The times tell those two apart.
export function openingHoursNote(
  slot: Slot,
  opensAt: string,
  closesAt: string
): string | null {
  if (openingHoursCoverage(slot, opensAt, closesAt) !== "partial") return null;

  const open = parseClock(opensAt)!;
  const close = parseClock(closesAt)!;
  const { fromMinute, toMinute } = SLOT_BOUNDARIES[slot];
  const opensLate = open > fromMinute;
  const closesEarly = close < toMinute;

  if (opensLate && closesEarly) return `Open ${asClock(open)}–${asClock(close)}`;
  if (opensLate) return `Open from ${asClock(open)}`;
  return `Open until ${asClock(close)}`;
}
