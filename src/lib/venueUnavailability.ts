// Unavailable periods: a venue out of use from one slot until another.
//
// SPM-45 (Record Venue Unavailability; Week 7 Change #2): Venue Staff mark a
// venue unavailable from a date and slot until the date and slot it is
// available again. The customer answered "can a venue be partially blocked?"
// with the three slots (#50), so a period is stated in slots, not whole days.
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

import { formatDate } from "@/lib/format";
import type { FieldErrors } from "@/lib/formErrors";
import {
  SLOTS,
  SLOT_BOUNDARIES,
  addDays,
  isDayKey,
  localDayKey,
  localDayStart,
  localMinuteOfDay,
  occupiedCells,
  type Interval,
  type Slot,
  type SlotCell,
  type Turnaround,
} from "@/lib/venueSlots";

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
// DAYS AND SLOTS <-> THE STORED INTERVAL
// ---------------------------------------------------------------------------

/// A period as Venue Staff state it: the first slot the venue is out of use,
/// and the first slot it is back. Days are Singapore calendar days.
export interface PeriodBounds {
  fromDay: string;
  fromSlot: Slot;
  untilDay: string;
  untilSlot: Slot;
}

function slotStart(day: string, slot: Slot): Date {
  return new Date(localDayStart(day).getTime() + SLOT_BOUNDARIES[slot].fromMinute * 60_000);
}

/// The interval to store: from the START of the first unavailable slot to the
/// START of the first available one. Ending there, not at the end of the last
/// unavailable slot, is what makes "available again from 15 Jun PM" leave
/// 15 Jun PM free while still covering all of 15 Jun AM.
export function periodInterval(bounds: PeriodBounds): Interval {
  return {
    startsAt: slotStart(bounds.fromDay, bounds.fromSlot),
    endsAt: slotStart(bounds.untilDay, bounds.untilSlot),
  };
}

/// A stored interval, back as days and slots. Exact for anything
/// periodInterval() produced. A row that does not sit on slot starts - one
/// seeded as whole days, or a period ended early part-way through a slot - is
/// read the generous way: unavailable from the slot its start falls in (or the
/// next one), available again from the first slot that starts at or after its
/// end.
export function periodBounds(interval: Interval): PeriodBounds {
  const startDay = localDayKey(interval.startsAt);
  const startMinute = localMinuteOfDay(interval.startsAt);
  // Night ends at 24:00, so a slot ending after any minute of the day exists.
  const fromSlot = SLOTS.find((slot) => SLOT_BOUNDARIES[slot].toMinute > startMinute) ?? SLOTS[SLOTS.length - 1];

  const endDay = localDayKey(interval.endsAt);
  const endMinute = localMinuteOfDay(interval.endsAt);
  const untilSlot = SLOTS.find((slot) => SLOT_BOUNDARIES[slot].fromMinute >= endMinute);

  return {
    fromDay: startDay,
    fromSlot,
    // After the last slot has started, the venue is back the next morning.
    untilDay: untilSlot ? endDay : addDays(endDay, 1),
    untilSlot: untilSlot ?? SLOTS[0],
  };
}

/// "Unavailable from 10 Jun 2027 PM. Available again from 15 Jun 2027 PM."
export function describePeriod(bounds: PeriodBounds): string {
  const day = (dayKey: string) => formatDate(localDayStart(dayKey));
  return (
    `Unavailable from ${day(bounds.fromDay)} ${bounds.fromSlot}. ` +
    `Available again from ${day(bounds.untilDay)} ${bounds.untilSlot}.`
  );
}

// ---------------------------------------------------------------------------
// WHICH BOOKINGS A PERIOD AFFECTS
// ---------------------------------------------------------------------------

function overlapping(a: Interval, b: Interval): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && a.endsAt.getTime() > b.startsAt.getTime();
}

function cellInterval(cell: SlotCell): Interval {
  const dayStart = localDayStart(cell.day).getTime();
  const { fromMinute, toMinute } = SLOT_BOUNDARIES[cell.slot];
  return {
    startsAt: new Date(dayStart + fromMinute * 60_000),
    endsAt: new Date(dayStart + toMinute * 60_000),
  };
}

/// Does the period cover a slot this booking holds?
///
/// "Holds" includes the booking's setup and turnaround slots, because the room
/// is committed for those too - the same rule the calendar's overlap warning
/// and the booking conflict check use, and the one SPM-80 states for its own
/// re-check ("a booking's setup or turnaround period now falls on a recorded
/// unavailable period").
export function bookingInPeriod(booking: Interval, venue: Turnaround, period: Interval): boolean {
  const cells = occupiedCells(booking, venue);
  // A booking that touches no slot at all (12:15-12:45, say) still occupies
  // the room for its own minutes.
  if (cells.length === 0) return overlapping(booking, period);
  return cells.some((cell) => overlapping(cellInterval(cell), period));
}

export type PeriodPhase = "upcoming" | "current" | "past";

/// Whether a period is still to come, under way, or over. Half-open like every
/// interval here: at the moment the venue is back, the period is past - which
/// is all "available again without any action" (AC4) needs.
export function periodPhase(period: Interval, now: Date): PeriodPhase {
  if (now.getTime() < period.startsAt.getTime()) return "upcoming";
  return now.getTime() < period.endsAt.getTime() ? "current" : "past";
}

// ---------------------------------------------------------------------------
// THE FORM
// ---------------------------------------------------------------------------

export const PERIOD_ORDER_ERROR = "The venue must become available again after it becomes unavailable.";
export const OTHER_REASON_ERROR = "Describe the reason.";

/// The "Mark unavailable" dialog's fields, as typed.
export interface PeriodFormValues {
  fromDay: string;
  fromSlot: Slot;
  untilDay: string;
  untilSlot: Slot;
  /// "" until a reason is chosen.
  reason: string;
  otherReason: string;
}

export const EMPTY_PERIOD_FORM: PeriodFormValues = {
  fromDay: "",
  fromSlot: "AM",
  untilDay: "",
  untilSlot: "AM",
  reason: "",
  otherReason: "",
};

/// What the dialog refuses before sending. A convenience mirroring
/// venueUnavailabilitySchema (src/lib/validation/venues.ts), which is the
/// authority.
export function validatePeriodForm(values: PeriodFormValues): FieldErrors {
  const errors: FieldErrors = {};

  if (!isDayKey(values.fromDay)) errors.fromDay = "Enter the date the venue becomes unavailable.";
  if (!isDayKey(values.untilDay)) {
    errors.untilDay = "Enter the date the venue becomes available again.";
  } else if (!errors.fromDay) {
    const { startsAt, endsAt } = periodInterval(values);
    if (endsAt.getTime() <= startsAt.getTime()) errors.untilDay = PERIOD_ORDER_ERROR;
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
    fromSlot: values.fromSlot,
    untilDay: values.untilDay,
    untilSlot: values.untilSlot,
    reason: values.reason,
    ...(values.reason === "other" ? { otherReason: values.otherReason.trim() } : {}),
  };
}
