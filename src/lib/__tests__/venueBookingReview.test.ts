import { describe, it, expect } from "vitest";
import {
  ALREADY_DECIDED_MESSAGE,
  BOOKING_REJECTION_REASON_REQUIRED,
  approvalConflict,
  awaitingEventApproval,
  checkBookingDecision,
  type BookingDecisionInput,
  type ConfirmedBooking,
} from "../venueBookingReview";
import { decideVenueBookingSchema } from "../validation";

// SPM-43 (Review Venue Booking Request), with SPM-93's rule for conflicts: a
// booking occupies the room from its start minus the venue's setup to its end
// plus its turnaround (Week 7 Customer Changes, Change #1). Written with an
// explicit +08:00 so each case reads as the time a user sees.

const sgt = (iso: string) => new Date(`${iso}+08:00`);

// A pending request for Orchard Seminar Room, 6 Mar 2027 09:00-17:00. With 60
// min setup and 30 min turnaround the room is in use 08:00-17:30.
const base: BookingDecisionInput = {
  decision: { decision: "approve" },
  booking: {
    id: "request",
    status: "pending",
    venueId: "orc-sem",
    startsAt: sgt("2027-03-06T09:00:00"),
    endsAt: sgt("2027-03-06T17:00:00"),
  },
  eventStatus: "planning",
  venue: {
    name: "Orchard Seminar Room",
    isActive: true,
    setupMinutes: 60,
    teardownMinutes: 30,
    bookings: [],
    unavailability: [],
  },
};

const confirmed = (startsAt: string, endsAt: string, id = "other"): ConfirmedBooking => ({
  id,
  startsAt: sgt(startsAt),
  endsAt: sgt(endsAt),
  eventReference: "EVT-000042",
  eventTitle: "Product Showcase",
});

const withConfirmed = (...bookings: ConfirmedBooking[]): BookingDecisionInput => ({
  ...base,
  venue: { ...base.venue, bookings },
});

const reject = (
  reason: string,
  extra: { suggestedVenueId?: string; suggestedAlternative?: string } = {}
): BookingDecisionInput => ({ ...base, decision: { decision: "reject", reason, ...extra } });

describe("approving a booking request (AC3, AC7)", () => {
  // SPM-82 (AC5): an expired hold was never a booking, and cannot be decided
  // now - not even rejected. The Coordinator submits a new request instead.
  it("[SPM-82][AC5] SPM-82: refuses to approve or reject a hold that has expired, saying what to do instead", () => {
    const expired = { ...base, booking: { ...base.booking, status: "expired" } };
    const message = "This hold has expired. The Coordinator must submit a new request.";

    expect(checkBookingDecision(expired)).toEqual({ ok: false, error: message });
    expect(checkBookingDecision({ ...expired, decision: { decision: "reject", reason: "Too late" } })).toEqual({
      ok: false,
      error: message,
    });
  });

  it("[SPM-43][AC3] a pending request for a free room can be approved", () => {
    expect(checkBookingDecision(base)).toEqual({ ok: true });
  });

  it("[SPM-43][AC3][AC4] a request is decided once: approved, rejected and cancelled ones are refused", () => {
    for (const status of ["approved", "rejected", "cancelled"]) {
      const input = { ...base, booking: { ...base.booking, status } };
      expect(checkBookingDecision(input)).toEqual({ ok: false, error: ALREADY_DECIDED_MESSAGE });
      expect(checkBookingDecision({ ...input, decision: { decision: "reject", reason: "Too late" } })).toEqual({
        ok: false,
        error: ALREADY_DECIDED_MESSAGE,
      });
    }
  });

  it("[SPM-43][AC3] a completed, cancelled or rejected event's request cannot be approved", () => {
    for (const eventStatus of ["completed", "cancelled", "rejected"]) {
      expect(checkBookingDecision({ ...base, eventStatus })).toEqual({
        ok: false,
        error: "A booking cannot be approved for a completed, cancelled or rejected event. Reject it instead.",
      });
    }
    for (const eventStatus of ["approved", "planning", "confirmed", "postponed"]) {
      expect(checkBookingDecision({ ...base, eventStatus }).ok).toBe(true);
    }
  });

  it("[SPM-43][AC3] a request for an event not yet approved cannot be approved, but can be rejected (SPM-54)", () => {
    for (const eventStatus of ["submitted", "under_review"]) {
      expect(checkBookingDecision({ ...base, eventStatus })).toEqual({
        ok: false,
        error: awaitingEventApproval(eventStatus),
      });
      expect(checkBookingDecision({ ...reject("Event not approved yet"), eventStatus })).toEqual({ ok: true });
    }
    expect(awaitingEventApproval("under_review")).toMatch(/has not been approved yet/);
    for (const eventStatus of ["approved", "planning", "confirmed"]) {
      expect(awaitingEventApproval(eventStatus)).toBeNull();
    }
  });

  it("[SPM-43][AC3] a request for a retired venue cannot be approved", () => {
    expect(checkBookingDecision({ ...base, venue: { ...base.venue, isActive: false } })).toEqual({
      ok: false,
      error: "Orchard Seminar Room has been retired. Reject this request and suggest another venue.",
    });
  });
});

describe("conflicts at approval", () => {
  it("[SPM-44][AC6][AC9] another approved booking at the same times blocks, and is named with its room-in-use period", () => {
    expect(checkBookingDecision(withConfirmed(confirmed("2027-03-06T11:00:00", "2027-03-06T15:00:00")))).toEqual({
      ok: false,
      error:
        "This overlaps an approved booking: EVT-000042 Product Showcase holds Orchard Seminar Room on 6 Mar 2027, 11:00–15:00 (room in use 10:00–15:30).",
    });
  });

  it("[SPM-93][AC7] [SPM-44][AC6] SPM-93-TC14: a clash only through setup or turnaround blocks too, and says so", () => {
    // The other booking's setup starts at 17:00; this request's turnaround runs to 17:30.
    expect(approvalConflict(base.venue, base.booking)).toBeNull();
    expect(
      approvalConflict(
        { ...base.venue, bookings: [confirmed("2027-03-06T18:00:00", "2027-03-06T19:00:00")] },
        base.booking
      )
    ).toBe(
      "This overlaps an approved booking: EVT-000042 Product Showcase holds Orchard Seminar Room on 6 Mar 2027, 18:00–19:00 (room in use 17:00–19:30). The clash is through setup or turnaround time."
    );
  });

  it("[SPM-93][AC7] [SPM-44][AC6] SPM-93-TC14: a booking whose setup starts as this request's turnaround ends does not block", () => {
    expect(approvalConflict({ ...base.venue, bookings: [confirmed("2027-03-06T18:30:00", "2027-03-06T19:00:00")] }, base.booking)).toBeNull();
  });

  it("[SPM-44][AC10] an approved booking far enough away does not block", () => {
    expect(checkBookingDecision(withConfirmed(confirmed("2027-03-08T09:00:00", "2027-03-08T17:00:00"))).ok).toBe(true);
  });

  it("[SPM-44][AC10] the request never clashes with itself", () => {
    expect(
      checkBookingDecision(withConfirmed(confirmed("2027-03-06T09:00:00", "2027-03-06T17:00:00", "request"))).ok
    ).toBe(true);
  });

  it("[SPM-44][AC8] a venue unavailability period blocks, with its reason", () => {
    const input = {
      ...base,
      venue: {
        ...base.venue,
        unavailability: [
          { reason: "internal_activity", startsAt: sgt("2027-03-06T00:00:00"), endsAt: sgt("2027-03-06T23:59:00") },
        ],
      },
    };
    expect(checkBookingDecision(input)).toEqual({
      ok: false,
      error: "Orchard Seminar Room is unavailable at this time (internal activity).",
    });
  });
});

describe("rejecting a booking request (AC4, AC5)", () => {
  it("[SPM-43][AC5] a reason is required: empty or spaces-only is refused on the reason field", () => {
    for (const reason of ["", "   ", "\n\t "]) {
      expect(checkBookingDecision(reject(reason))).toEqual({
        ok: false,
        error: BOOKING_REJECTION_REASON_REQUIRED,
        field: "reason",
      });
    }
  });

  it("[SPM-43][AC5] a request can be rejected with a reason alone", () => {
    expect(checkBookingDecision(reject("Hall closed for rigging work."))).toEqual({ ok: true });
  });

  it("[SPM-43][AC4] rejecting is allowed where approving is not: a conflict, a closed event, a retired venue", () => {
    const blocked: BookingDecisionInput = {
      ...reject("Room is already taken."),
      eventStatus: "cancelled",
      venue: {
        ...base.venue,
        isActive: false,
        bookings: [confirmed("2027-03-06T09:00:00", "2027-03-06T17:00:00")],
      },
    };
    expect(checkBookingDecision(blocked)).toEqual({ ok: true });
  });
});

describe("suggesting an alternative when rejecting (AC6)", () => {
  const REASON = "Hall closed for rigging work.";

  it("[SPM-43][AC6] an alternative arrangement in words needs no venue", () => {
    expect(checkBookingDecision(reject(REASON, { suggestedAlternative: "The PM slot on 7 Mar is free." }))).toEqual({
      ok: true,
    });
  });

  it("[SPM-43][AC6] another active venue can be suggested", () => {
    const input = { ...reject(REASON, { suggestedVenueId: "mar-aud" }), suggestedVenue: { id: "mar-aud", isActive: true } };
    expect(checkBookingDecision(input)).toEqual({ ok: true });
  });

  it("[SPM-43][AC6] a suggested venue that does not exist or is retired is refused", () => {
    const expected = { ok: false, error: "Choose a venue from the catalogue to suggest.", field: "suggestedVenueId" };
    expect(checkBookingDecision({ ...reject(REASON, { suggestedVenueId: "gone" }), suggestedVenue: null })).toEqual(expected);
    expect(
      checkBookingDecision({
        ...reject(REASON, { suggestedVenueId: "old" }),
        suggestedVenue: { id: "old", isActive: false },
      })
    ).toEqual(expected);
  });

  it("[SPM-43][AC6] the venue that was just refused cannot be the suggestion", () => {
    const input = { ...reject(REASON, { suggestedVenueId: "orc-sem" }), suggestedVenue: { id: "orc-sem", isActive: true } };
    expect(checkBookingDecision(input)).toEqual({
      ok: false,
      error: "Suggest a different venue from the one requested.",
      field: "suggestedVenueId",
    });
  });
});

describe("decideVenueBookingSchema", () => {
  const VENUE = "7b7c0f0e-6f0a-4a57-9a44-6f1f1d3a2c11";

  it("[SPM-43][AC3][AC4] accepts an approval, and a rejection with or without a suggestion", () => {
    expect(decideVenueBookingSchema.parse({ decision: "approve" })).toEqual({ decision: "approve" });
    expect(decideVenueBookingSchema.parse({ decision: "reject", reason: "No." })).toEqual({
      decision: "reject",
      reason: "No.",
    });
    expect(
      decideVenueBookingSchema.parse({
        decision: "reject",
        reason: "No.",
        suggestedVenueId: VENUE,
        suggestedAlternative: "  Try the PM slot.  ",
      })
    ).toEqual({ decision: "reject", reason: "No.", suggestedVenueId: VENUE, suggestedAlternative: "Try the PM slot." });
  });

  it("[SPM-43][AC6] treats blank suggestion fields as not given", () => {
    expect(
      decideVenueBookingSchema.parse({ decision: "reject", reason: "No.", suggestedVenueId: "", suggestedAlternative: "  " })
    ).toEqual({ decision: "reject", reason: "No." });
  });

  it("[SPM-43][AC5] lets a blank reason through for checkBookingDecision to refuse with the screen's message", () => {
    expect(decideVenueBookingSchema.safeParse({ decision: "reject", reason: "" }).success).toBe(true);
    expect(decideVenueBookingSchema.safeParse({ decision: "reject" }).success).toBe(false);
  });

  it("[SPM-43][AC6] refuses an unknown decision, a malformed venue id, and a suggestion on an approval (#110)", () => {
    expect(decideVenueBookingSchema.safeParse({ decision: "hold" }).success).toBe(false);
    expect(decideVenueBookingSchema.safeParse({ decision: "reject", reason: "No.", suggestedVenueId: "MAR-AUD" }).success).toBe(false);
    expect(decideVenueBookingSchema.safeParse({ decision: "approve", suggestedVenueId: VENUE }).success).toBe(false);
  });
});
