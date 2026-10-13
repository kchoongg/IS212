// Review Flagged Arrangements (SPM-68). A change to an event (SPM-62, SPM-64),
// a venue (SPM-39, SPM-45) or equipment (SPM-55) flags the arrangements it may
// have broken instead of changing them. The assigned Coordinator then looks at
// each one and keeps it, or replaces it.
//
// This file answers the two questions that screen asks:
//
//   why was it flagged?      flagReasons() - the stored codes, in words.
//   does it still fit?       assessFlaggedBooking() / assessFlaggedEquipment()
//                            - judged on the event as it is NOW, never on
//                            what was true when the flag was raised. Keep is
//                            refused unless it does (AC6, AC7).
//
// "Still fits" for a venue booking (decided 2026-10-13):
//   suitability   SPM-41's check, for the event's - or the session's - present
//                 attendance, layout and mandatory facilities.
//   availability  the venue has not been retired; the booking's own times
//                 still cover the event's (or session's) present time, the
//                 rule a new request must pass (SPM-93); and nothing else
//                 holds or blocks the room for the time the booking occupies
//                 (SPM-44's conflict check, setup and turnaround included).
//
// For equipment: SPM-48's availability for the event's present dates, not
// counting this line's own units, must cover what the line has reserved - or
// what it asks for, while Technical Support have reserved nothing yet.
//
// Nothing here changes an arrangement. Pure functions over plain data, like
// the rest of src/lib; src/lib/flaggedArrangementsService.ts loads the rows.

import { CHANGE_REASON_PROSE } from "@/lib/eventChangeImpact";
import { COMMITTING_REQUEST_STATUSES } from "@/lib/equipmentAvailability";
import { EQUIPMENT_REASON_PROSE } from "@/lib/equipmentOutOfService";
import { formatDateTimeRange } from "@/lib/format";
import { REGISTRATION_REASON_PROSE } from "@/lib/registrationSettings";
import { coversSchedule } from "@/lib/venueBookingRequest";
import { describeVenueConflict, findVenueConflict, type ConflictVenue } from "@/lib/venueConflict";
import { IMPACT_REASON_PROSE } from "@/lib/venueImpact";
import { checkVenueSuitability, describeUnmet, type EventNeeds, type VenueCapabilities } from "@/lib/venueSuitability";
import type { Interval } from "@/lib/venueTime";

// ---------------------------------------------------------------------------
// WHY IT WAS FLAGGED
// ---------------------------------------------------------------------------

/// Every reason code a review flag may carry, from every story that writes
/// one (src/lib/reviewFlags.ts).
const REASON_PROSE: Record<string, string> = {
  ...IMPACT_REASON_PROSE,
  ...CHANGE_REASON_PROSE,
  ...EQUIPMENT_REASON_PROSE,
  ...REGISTRATION_REASON_PROSE,
};

/// The stored reason codes, in words and in the stored order. A code this
/// file has not been taught (e.g. one a later story adds) is shown in its
/// plainest form rather than hiding that the arrangement is flagged, and a
/// flag with no code says so - as the Readiness tab does (SPM-33).
export function flagReasons(reviewReason: string | null | undefined): string[] {
  const reasons = (reviewReason ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean)
    .map((code) => REASON_PROSE[code] ?? code.replace(/_/g, " "));
  return reasons.length > 0 ? reasons : ["no reason was recorded"];
}

// ---------------------------------------------------------------------------
// DOES A VENUE BOOKING STILL FIT?
// ---------------------------------------------------------------------------

export interface FlaggedBookingInput {
  booking: Interval & { id: string; eventId: string; status: string };
  /// The event's present time, or the session's for a session's booking.
  /// Null while the event has no dates, when there is nothing to cover.
  schedule: Interval | null;
  /// Whose time `schedule` is - only for wording the refusal.
  holder: "event" | "session";
  /// The session's attendance and layout where there is a session; the
  /// facilities are always the event's.
  needs: EventNeeds;
  venue: ConflictVenue & VenueCapabilities & { isActive: boolean };
}

export interface Verdict {
  ok: boolean;
  /// What is not met, one sentence each. Empty when ok.
  unmet: string[];
}

export interface BookingAssessment {
  suitability: Verdict;
  availability: Verdict;
}

const verdict = (unmet: string[]): Verdict => ({ ok: unmet.length === 0, unmet });

export function assessFlaggedBooking({ booking, schedule, holder, needs, venue }: FlaggedBookingInput): BookingAssessment {
  const unsuitable = checkVenueSuitability(needs, venue).unmet.map(describeUnmet);

  const unavailable: string[] = [];
  if (!venue.isActive) {
    unavailable.push(`${venue.name} has been retired.`);
  }
  if (schedule && !coversSchedule(booking, schedule)) {
    unavailable.push(
      `The booking (${formatDateTimeRange(booking.startsAt, booking.endsAt)}) does not cover the ${holder}'s time ` +
        `(${formatDateTimeRange(schedule.startsAt, schedule.endsAt)}).`
    );
  }
  // The same question Venue Staff's approval asks (SPM-44): an approved
  // booking is in the way only of another approved one, a pending request of
  // either. Never itself, and never its own event's other rooms.
  const conflict = findVenueConflict(venue, booking, {
    eventId: booking.eventId,
    bookingId: booking.id,
    scope: booking.status === "approved" ? "approved" : "active",
  });
  if (conflict) {
    unavailable.push(describeVenueConflict(venue.name, conflict));
  }

  return { suitability: verdict(unsuitable), availability: verdict(unavailable) };
}

// ---------------------------------------------------------------------------
// DOES AN EQUIPMENT LINE STILL FIT?
// ---------------------------------------------------------------------------

export interface FlaggedEquipmentInput {
  status: string;
  quantityRequested: number;
  quantityReserved: number | null;
  /// Units free for the event's present dates, not counting this line's own.
  /// Null when the event has no dates, so nothing could be checked.
  available: number | null;
}

export interface EquipmentAssessment {
  ok: boolean;
  /// The quantity the available units have to cover.
  needed: number;
  available: number | null;
  /// "2 reserved, 4 available for these dates."
  summary: string;
}

export function assessFlaggedEquipment(line: FlaggedEquipmentInput): EquipmentAssessment {
  const held = COMMITTING_REQUEST_STATUSES.includes(line.status) && line.quantityReserved != null;
  const needed = held ? line.quantityReserved! : line.quantityRequested;

  if (line.available == null) {
    return {
      ok: false,
      needed,
      available: null,
      summary: "Availability could not be checked: this event has no dates yet.",
    };
  }
  return {
    ok: line.available >= needed,
    needed,
    available: line.available,
    summary: `${needed} ${held ? "reserved" : "requested"}, ${line.available} available for these dates.`,
  };
}

// ---------------------------------------------------------------------------
// WORDING
// ---------------------------------------------------------------------------

/// AC7: the refusal names the arrangement and every requirement it no longer meets.
export function keepRefusal(name: string, unmet: readonly string[]): string {
  return `${name} no longer meets this event's requirements: ${unmet.join(" ")}`;
}

/// AC8: "12 registered, 3 on the waiting list".
export function registrationCountLine(registered: number, waitlisted: number): string {
  return `${registered} registered, ${waitlisted} on the waiting list`;
}
