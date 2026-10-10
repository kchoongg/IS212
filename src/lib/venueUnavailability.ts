// Unavailable periods: a venue out of use from one time until another.
//
// SPM-45 (Record Venue Unavailability; Week 7 Change #2): Venue Staff mark a
// venue unavailable from a date and time until the date and time it is
// available again, on the 15-minute booking grid (#126, #128; SPM-93). The
// customer answered "can a venue be partially blocked?" with part of a day
// (#50), so a period is stated in times, not whole days.
//
// A period is a VenueUnavailability row. Everything that READS that table was
// built first and needs nothing from here: the calendar (SPM-46), venue search
// (SPM-40), and the booking request and approval checks (SPM-42, SPM-43). This
// module is the part that was missing - turning what Venue Staff state into
// the stored interval and back, and deciding which bookings a period affects.
//
// PURE functions over plain data - no Prisma, no NextRequest - for the same
// reason src/lib/venueImpact.ts is. The routes under
// src/app/api/venues/[id]/unavailability load the rows and write the flags.

import { formatDateTime } from "@/lib/format";
import type { FieldErrors } from "@/lib/formErrors";
import {
  BOOKING_STEP_MINUTES,
  asClock,
  atLocalTime,
  isDayKey,
  isOnGrid,
  localDayKey,
  localMinuteOfDay,
  occupiedWindow,
  overlapping,
  parseClock,
  type Interval,
  type Turnaround,
} from "@/lib/venueTime";

// ---------------------------------------------------------------------------
// REASONS
// ---------------------------------------------------------------------------

/// Why a venue is unavailable, in the order the picker offers them. Week 7
/// Change #2 lists "maintenance, equipment failure, renovation, safety
/// concerns, or other operational reasons"; the Week 1 briefing adds "internal
/// activities". Stored in VenueUnavailability.reason, which is free text, so a
/// new code here needs no migration.
export const UNAVAILABILITY_REASONS = [
  "maintenance",
  "equipment_failure",
  "renovation",
  "safety",
  "internal_activity",
  "other",
] as const;

export type UnavailabilityReason = (typeof UNAVAILABILITY_REASONS)[number];

/// "equipment_failure" -> "Equipment failure". Works for any stored value, so
/// a row written before this list existed still gets a readable label.
export function unavailabilityReasonLabel(reason: string): string {
  const spaced = reason.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/// The longest description of an "other" reason, kept in the row's notes.
export const OTHER_REASON_MAX = 500;

// ---------------------------------------------------------------------------
// DATES AND TIMES <-> THE STORED INTERVAL
// ---------------------------------------------------------------------------

/// A period as Venue Staff state it: when the venue becomes unavailable, and
/// when it is available again. Days are Singapore calendar days ("YYYY-MM-DD")
/// and times Singapore wall-clock times ("HH:MM").
export interface PeriodBounds {
  fromDay: string;
  fromTime: string;
  untilDay: string;
  untilTime: string;
}

/// The interval to store: exactly what was stated. Half-open like every
/// interval in the venues domain, so "available again from 13:00" leaves 13:00
/// itself free. Assumes valid days and times - check them first.
export function periodInterval(bounds: PeriodBounds): Interval {
  return {
    startsAt: atLocalTime(bounds.fromDay, bounds.fromTime),
    endsAt: atLocalTime(bounds.untilDay, bounds.untilTime),
  };
}

/// A stored interval, back as dates and times. Exact for any row, including
/// one seeded as whole days (midnight to midnight).
export function periodBounds(interval: Interval): PeriodBounds {
  return {
    fromDay: localDayKey(interval.startsAt),
    fromTime: asClock(localMinuteOfDay(interval.startsAt)),
    untilDay: localDayKey(interval.endsAt),
    untilTime: asClock(localMinuteOfDay(interval.endsAt)),
  };
}

/// "Unavailable from 10 Jun 2027, 13:00. Available again from 15 Jun 2027, 13:00."
export function describePeriod(bounds: PeriodBounds): string {
  const { startsAt, endsAt } = periodInterval(bounds);
  return `Unavailable from ${formatDateTime(startsAt)}. Available again from ${formatDateTime(endsAt)}.`;
}

// ---------------------------------------------------------------------------
// WHICH BOOKINGS A PERIOD AFFECTS
// ---------------------------------------------------------------------------

/// AC3: does the booking's occupied period overlap the unavailable period?
///
/// "Occupied" is the booking's own times plus the venue's setup before and
/// turnaround after (Week 7 Change #1), because the room is committed for
/// those too - the same rule the calendar's overlap warning and the booking
/// conflict check use. Periods that only meet end to start do not overlap.
export function bookingInPeriod(booking: Interval, venue: Turnaround, period: Interval): boolean {
  return overlapping(occupiedWindow(booking, venue), period);
}

export type PeriodPhase = "upcoming" | "current" | "past";

/// Whether a period is still to come, under way, or over. Half-open like every
/// interval here: at the moment the venue is back, the period is past - which
/// is all "available again without any action" (AC4) needs.
export function periodPhase(period: Interval, now: Date): PeriodPhase {
  if (now.getTime() < period.startsAt.getTime()) return "upcoming";
  return now.getTime() < period.endsAt.getTime() ? "current" : "past";
}

/// AC5, "end it early": the time a period under way ends when it is ended now.
/// Now, rounded DOWN to the 15-minute grid - so the venue is available again
/// straight away and the stored time stays on the grid. Null when that would
/// leave nothing of the period (it began within the last step), in which case
/// the caller removes it.
///
/// Rounding the instant itself is right for any zone whose offset is a whole
/// number of quarter hours, which Singapore's is.
export function endEarlyAt(period: Interval, now: Date): Date | null {
  const step = BOOKING_STEP_MINUTES * 60_000;
  const end = new Date(Math.floor(now.getTime() / step) * step);
  return end.getTime() > period.startsAt.getTime() ? end : null;
}

// ---------------------------------------------------------------------------
// THE FORM
// ---------------------------------------------------------------------------

export const TIME_GRID_ERROR = "Choose a time on a 15-minute step (:00, :15, :30 or :45).";
export const PERIOD_ORDER_ERROR = "The venue must become available again after it becomes unavailable.";
/// A period whose return is not still to come would be saved and then never
/// listed - the venue page shows only periods under way or coming up - and
/// could flag nothing, so it is refused (decided 2026-10-09). One that began
/// in the past and is still under way is fine: a failure is often recorded
/// after it starts.
export const PERIOD_OVER_ERROR = "This period is already over.";
export const OTHER_REASON_ERROR = "Describe the reason.";

/// The "Mark unavailable" dialog's fields, as typed. All "" until filled in.
export interface PeriodFormValues extends PeriodBounds {
  reason: string;
  otherReason: string;
}

export const EMPTY_PERIOD_FORM: PeriodFormValues = {
  fromDay: "",
  fromTime: "",
  untilDay: "",
  untilTime: "",
  reason: "",
  otherReason: "",
};

/// What is wrong with a typed time, if anything.
function timeError(value: string, missing: string): string | undefined {
  if (parseClock(value) === null) return missing;
  return isOnGrid(value) ? undefined : TIME_GRID_ERROR;
}

/// What the dialog refuses before sending. A convenience mirroring
/// venueUnavailabilitySchema (src/lib/validation/venues.ts), which is the
/// authority.
export function validatePeriodForm(values: PeriodFormValues, now: Date = new Date()): FieldErrors {
  const errors: FieldErrors = {};

  if (!isDayKey(values.fromDay)) errors.fromDay = "Enter the date the venue becomes unavailable.";
  const fromTime = timeError(values.fromTime, "Enter the time the venue becomes unavailable.");
  if (fromTime) errors.fromTime = fromTime;
  if (!isDayKey(values.untilDay)) errors.untilDay = "Enter the date the venue becomes available again.";
  const untilTime = timeError(values.untilTime, "Enter the time the venue becomes available again.");
  if (untilTime) errors.untilTime = untilTime;

  // AC2, once there are two readable moments to compare.
  if (Object.keys(errors).length === 0) {
    const period = periodInterval(values);
    if (period.endsAt.getTime() <= period.startsAt.getTime()) errors.untilTime = PERIOD_ORDER_ERROR;
    else if (periodPhase(period, now) === "past") errors.untilTime = PERIOD_OVER_ERROR;
  }

  if (!values.reason) {
    errors.reason = "Choose a reason.";
  } else if (values.reason === "other" && !values.otherReason.trim()) {
    errors.otherReason = OTHER_REASON_ERROR;
  }

  return errors;
}

/// The request body for a period. The description is sent only for "other" -
/// one typed before the reason was changed is not carried along.
export function periodPayload(values: PeriodFormValues) {
  return {
    fromDay: values.fromDay,
    fromTime: values.fromTime,
    untilDay: values.untilDay,
    untilTime: values.untilTime,
    reason: values.reason,
    ...(values.reason === "other" ? { otherReason: values.otherReason.trim() } : {}),
  };
}
