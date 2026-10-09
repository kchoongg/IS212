// When a venue is in use, in 15-minute steps.
//
// SPM-93 "Book Venues in 15-Minute Units" replaced the three fixed daily slots
// (AM / PM / Night, #50) with times. The customer's rulings:
//
//   #128 (2026-10-02) - "the change of 3 slots to 15mins as the smallest unit
//         of booking".
//   #126 (2026-10-06) - "the smallest unit of booking is 15mins, there will be
//         no fixed lunch and dinner blackout period".
//   Week 7 Customer Changes, Change #1 - each venue has a setup and a
//         turnaround time, and "these periods must be included when checking
//         availability and detecting booking conflicts. For example, an event
//         scheduled from 10:00am to 12:00pm with 30 minutes of setup and 45
//         minutes of turnaround effectively occupies the venue from 9:30am to
//         12:45pm."
//
// They supersede #107, #108 and #123, which made a booking take whole slots and
// setup and turnaround a whole adjacent slot each. Bookings, holds and
// unavailable periods were always stored as real start and end instants; the
// slots only ever existed in the rules and the display, so this module is the
// whole of the change to the rules.
//
// Everything here is a PURE function over plain data - no Prisma, no
// NextRequest - like src/lib/permissions.ts, so the rules can be tested
// without a database.

import { TIME_ZONE, formatDateTimeRange } from "@/lib/format";

/// The smallest unit of booking (#126, #128). A booking's start and end, and a
/// venue's setup and turnaround minutes, are all whole multiples of it.
export const BOOKING_STEP_MINUTES = 15;

export interface Interval {
  startsAt: Date;
  endsAt: Date;
}

/// A venue's setup and turnaround. Structural rather than the Prisma type so
/// these functions can be tested with object literals. `teardownMinutes` is
/// the column's name; the customer calls it turnaround (Week 7, Change #1).
export interface Turnaround {
  setupMinutes: number;
  teardownMinutes: number;
}

// ---------------------------------------------------------------------------
// LOCAL TIME
// ---------------------------------------------------------------------------
//
// Bookings are stored as instants; the times a person types and reads are
// Singapore wall-clock (#36). The two only meet in a timezone, and the project
// already has one: format.ts displays everything in it.

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

/// The local calendar day an instant falls on, as "YYYY-MM-DD".
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
/// minute of that day - so the rest of the module is plain integer arithmetic.
function localAbsoluteMinute(instant: Date): number {
  const { year, month, day, hour, minute } = localParts(instant);
  const dayNumber = Date.UTC(year, month - 1, day) / 86_400_000;
  return dayNumber * 1440 + hour * 60 + minute;
}

function dayKeyFromDayNumber(dayNumber: number): string {
  return new Date(dayNumber * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// CALENDAR DAYS
// ---------------------------------------------------------------------------

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

/// The instant a local day begins - local midnight. Derives the zone's offset
/// rather than hard-coding +08:00. (Exact for a fixed-offset zone like
/// Singapore's; a zone with daylight saving could be an hour out on the
/// changeover day itself.)
export function localDayStart(dayKey: string): Date {
  const dayNumber = dayNumberOf(dayKey) ?? 0;
  const utcMidnight = dayNumber * 86_400_000;
  const offsetMinutes = localAbsoluteMinute(new Date(utcMidnight)) - dayNumber * 1440;
  return new Date(utcMidnight - offsetMinutes * 60_000);
}

// ---------------------------------------------------------------------------
// CLOCK TIMES
// ---------------------------------------------------------------------------

/// "08:30" -> 510. Null for anything that is not a valid 24-hour time.
export function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/// 570 -> "09:30". The end of the day, 1440, is "24:00": a period running to
/// midnight ends at 24:00 of its own day, not 00:00 of the next.
export function asClock(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/// Is "HH:MM" a time on the 15-minute grid? False for anything unreadable.
export function isOnGrid(clock: string): boolean {
  const minutes = parseClock(clock);
  return minutes !== null && minutes % BOOKING_STEP_MINUTES === 0;
}

/// A Singapore wall-clock time on a local day, as an instant. Assumes both are
/// valid - check them with isDayKey() and parseClock() first.
export function atLocalTime(dayKey: string, clock: string): Date {
  return new Date(localDayStart(dayKey).getTime() + (parseClock(clock) ?? 0) * 60_000);
}

/// "13:30–16:45" for a period within one day (ending at "24:00" when it runs
/// to midnight), otherwise both dates and times.
export function timeRangeLabel(interval: Interval): string {
  const from = localAbsoluteMinute(interval.startsAt);
  const to = localAbsoluteMinute(interval.endsAt);
  const day = Math.floor(from / 1440);
  if (to > from && to <= (day + 1) * 1440) {
    return `${asClock(from - day * 1440)}–${asClock(to - day * 1440)}`;
  }
  return formatDateTimeRange(interval.startsAt, interval.endsAt);
}

// ---------------------------------------------------------------------------
// THE RULES
// ---------------------------------------------------------------------------

/// AC2: an event's times widened outwards to the 15-minute grid - the start
/// down, the end up - so a request defaulting to them covers the whole event.
/// Seconds are dropped first.
export function widenToGrid(interval: Interval): Interval {
  const step = BOOKING_STEP_MINUTES;
  const from = localAbsoluteMinute(interval.startsAt);
  const to = localAbsoluteMinute(interval.endsAt);
  const shift = (instant: Date, local: number, target: number) =>
    new Date(Math.floor(instant.getTime() / 60_000) * 60_000 + (target - local) * 60_000);
  return {
    startsAt: shift(interval.startsAt, from, Math.floor(from / step) * step),
    endsAt: shift(interval.endsAt, to, Math.ceil((to + (hasSeconds(interval.endsAt) ? 1 : 0)) / step) * step),
  };
}

/// An end at 10:00:30 is past 10:00, so it widens to 10:15, not 10:00.
function hasSeconds(instant: Date): boolean {
  return instant.getTime() % 60_000 !== 0;
}

/// AC6: how long a booking takes the room out of use - from its start minus
/// the venue's setup to its end plus its turnaround (Week 7, Change #1). Every
/// availability and conflict check compares these, never the booked times
/// alone. Can cross midnight.
export function occupiedWindow(booking: Interval, venue: Turnaround): Interval {
  return {
    startsAt: new Date(booking.startsAt.getTime() - venue.setupMinutes * 60_000),
    endsAt: new Date(booking.endsAt.getTime() + venue.teardownMinutes * 60_000),
  };
}

/// AC7: half-open overlap - each starts before the other ends. Two periods
/// that only meet end to start do not overlap. The one test used everywhere in
/// the venues domain (SCHEMA_REFERENCE.md).
export function overlapping(a: Interval, b: Interval): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && a.endsAt.getTime() > b.startsAt.getTime();
}

/// AC4: is a period inside the venue's opening hours (#46: Venue Staff
/// maintain them, every day the same)? Callers pass the OCCUPIED window, so
/// setup and turnaround have to fit too - a room cannot be set up while it is
/// closed (team decision 2026-10-08, from the Week 1 briefing and Week 7
/// Change #1; our question #131 is still open with the customer).
///
/// The start must be at or after opening on the first day, and the end at or
/// before closing on the last. A multi-day event is not checked overnight - an
/// event running 09:00 Monday to 18:00 Tuesday is two days of use, not a claim
/// on the room at 3am.
///
/// Unreadable or inverted hours pass rather than fail: the venue form rejects
/// both, so reaching this means bad data, and hiding a real room because of it
/// would be worse.
export function withinOpeningHours(
  venue: { opensAt: string; closesAt: string },
  window: Interval
): boolean {
  const opens = parseClock(venue.opensAt);
  const closes = parseClock(venue.closesAt);
  if (opens == null || closes == null || closes <= opens) return true;

  const startMinute = localMinuteOfDay(window.startsAt);
  // An end at exactly midnight is the END of the previous day (24:00).
  const endsAtMidnight = localMinuteOfDay(window.endsAt) === 0;
  const endMinute = endsAtMidnight ? 1440 : localMinuteOfDay(window.endsAt);

  return startMinute >= opens && endMinute <= closes;
}

/// The part of a period that falls on one local day, as minutes of that day
/// (0–1440), or null when it does not touch the day. For laying a booking out
/// on a calendar row; a period crossing midnight appears on both days.
export function partOnDay(interval: Interval, dayKey: string): { from: number; to: number } | null {
  const dayStart = (dayNumberOf(dayKey) ?? 0) * 1440;
  const from = Math.max(localAbsoluteMinute(interval.startsAt), dayStart);
  const to = Math.min(localAbsoluteMinute(interval.endsAt), dayStart + 1440);
  return to > from ? { from: from - dayStart, to: to - dayStart } : null;
}
