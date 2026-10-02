// Review Venue Booking Request (SPM-43). The BPMN's Venue Staff step, "Review
// booking & check conflicts", and the gateway after it: approved, or
// "reject / suggest alt. venue" back to the coordinator's venue search.
//
// An approved request IS the confirmed booking (AC7): VenueBooking.status
// "approved" is the state the availability calendar (SPM-46) shows as booked
// and conflict detection compares against. Approving changes nothing on the
// event - confirming the event is the coordinator's step, once every
// arrangement is in place (#80).
//
// Pure functions over plain data, like the rest of src/lib. The route
// (src/app/api/venue-bookings/[id]/route.ts) loads the rows and calls these.

import { isTerminalEventStatus } from "@/lib/statuses";
import { requestSlotsLabel } from "@/lib/venueBookingRequest";
import { occupiedWindow, type Interval, type Turnaround } from "@/lib/venueSlots";

/// A request is decided once: only a pending one can be approved or rejected.
export const DECIDABLE_BOOKING_STATUSES: readonly string[] = ["pending"];

export const ALREADY_DECIDED_MESSAGE = "This booking request has already been decided.";

/// Shown under the Reason field when it is empty or only spaces - the same
/// rule the API applies (AC5).
export const BOOKING_REJECTION_REASON_REQUIRED =
  "A reason is required when rejecting. The Coordinator sees this message.";

/// An APPROVED booking at the venue, with enough to name it in a refusal.
export interface ConfirmedBooking extends Interval {
  id: string;
  eventReference: string;
  eventTitle: string | null;
}

/// The parts of a venue a decision reads. `bookings` are its approved ones
/// only: at approval a rival PENDING request must not block, because approving
/// one is how Venue Staff choose between two.
export interface ReviewVenue extends Turnaround {
  name: string;
  isActive: boolean;
  bookings: readonly ConfirmedBooking[];
  unavailability: readonly (Interval & { reason: string })[];
}

function overlapping(a: Interval, b: Interval): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && a.endsAt.getTime() > b.startsAt.getTime();
}

/// Why this request cannot be approved as it stands, or null when the room is
/// free. Re-checked at approval rather than trusted from request time: the
/// room can be blocked, or another request approved, in between (#35).
///
/// The same slot rules as request time (SPM-42): the request needs its own
/// slots plus the venue's setup and turnaround slots, and so does every
/// approved booking it is compared with (#107, #108, #123).
///
/// SPM-44 (Booking Conflict Detection) carries checkVenueBookingApproval() in
/// src/lib/venueConflict.ts on its own branch - once that is merged, this
/// function should call it instead of keeping a second copy of the rule.
export function approvalConflict(venue: ReviewVenue, booking: Interval & { id: string }): string | null {
  const needed = occupiedWindow(booking, venue);

  const block = venue.unavailability.find((u) => overlapping(needed, u));
  if (block) {
    return `${venue.name} is unavailable at this time (${block.reason.replace(/_/g, " ")}).`;
  }

  const clash = venue.bookings.find(
    (b) => b.id !== booking.id && overlapping(needed, occupiedWindow(b, venue))
  );
  if (!clash) return null;

  const holder = [clash.eventReference, clash.eventTitle].filter(Boolean).join(" ");
  const viaTurnaround = overlapping(booking, clash) ? "" : " The clash is through a setup or turnaround slot.";
  return `This overlaps an approved booking: ${holder} holds ${venue.name} on ${requestSlotsLabel(clash)}.${viaTurnaround}`;
}

export type BookingDecision =
  | { decision: "approve" }
  | { decision: "reject"; reason: string; suggestedVenueId?: string; suggestedAlternative?: string };

export interface BookingDecisionInput {
  decision: BookingDecision;
  booking: Interval & { id: string; status: string; venueId: string };
  eventStatus: string;
  venue: ReviewVenue;
  /// The venue suggested instead, as loaded - null when the id matched nothing.
  /// Ignored unless the decision carries a suggestedVenueId.
  suggestedVenue?: { id: string; isActive: boolean } | null;
}

export type BookingDecisionCheck =
  | { ok: true }
  | { ok: false; error: string; field?: "reason" | "suggestedVenueId" };

/// Every rule a decision must pass. Returns the first reason it is refused,
/// with the form field it belongs to where there is one.
export function checkBookingDecision(input: BookingDecisionInput): BookingDecisionCheck {
  const { decision, booking, venue } = input;
  const refuse = (error: string, field?: "reason" | "suggestedVenueId"): BookingDecisionCheck => ({
    ok: false,
    error,
    field,
  });

  if (!DECIDABLE_BOOKING_STATUSES.includes(booking.status)) return refuse(ALREADY_DECIDED_MESSAGE);

  if (decision.decision === "approve") {
    if (isTerminalEventStatus(input.eventStatus)) {
      return refuse("A booking cannot be approved for a completed, cancelled or rejected event. Reject it instead.");
    }
    if (!venue.isActive) {
      return refuse(`${venue.name} has been retired. Reject this request and suggest another venue.`);
    }
    const conflict = approvalConflict(venue, booking);
    return conflict ? refuse(conflict) : { ok: true };
  }

  // AC5: blank or spaces-only is no reason.
  if (decision.reason.trim() === "") return refuse(BOOKING_REJECTION_REASON_REQUIRED, "reason");

  // AC6: the suggestion is optional, but a suggested venue must be one the
  // coordinator can actually request - in the catalogue, and not the room
  // that was just refused.
  if (decision.suggestedVenueId) {
    if (!input.suggestedVenue || !input.suggestedVenue.isActive) {
      return refuse("Choose a venue from the catalogue to suggest.", "suggestedVenueId");
    }
    if (decision.suggestedVenueId === booking.venueId) {
      return refuse("Suggest a different venue from the one requested.", "suggestedVenueId");
    }
  }

  return { ok: true };
}
