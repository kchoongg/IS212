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

// SPM-43 (Review Venue Booking Request). Slot times are the customer's (#50):
// AM 07:00-12:00, PM 13:00-18:00, Night 19:00-24:00, Singapore time. Written
// with an explicit +08:00 so each case reads as the time a user sees.

const sgt = (iso: string) => new Date(`${iso}+08:00`);

// A pending request for Orchard Seminar Room, 6 Mar 2027 AM + PM. The room
// needs setup and turnaround, so it also takes 5 Mar Night and 6 Mar Night.
const base: BookingDecisionInput = {
  decision: { decision: "approve" },
  booking: {
    id: "request",
    status: "pending",
    venueId: "orc-sem",
    startsAt: sgt("2027-03-06T07:00:00"),
    endsAt: sgt("2027-03-06T18:00:00"),
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
  it("a pending request for a free room can be approved", () => {
    expect(checkBookingDecision(base)).toEqual({ ok: true });
  });

  it("a request is decided once: approved, rejected and cancelled ones are refused", () => {
    for (const status of ["approved", "rejected", "cancelled"]) {
      const input = { ...base, booking: { ...base.booking, status } };
      expect(checkBookingDecision(input)).toEqual({ ok: false, error: ALREADY_DECIDED_MESSAGE });
      expect(checkBookingDecision({ ...input, decision: { decision: "reject", reason: "Too late" } })).toEqual({
        ok: false,
        error: ALREADY_DECIDED_MESSAGE,
      });
    }
  });

  it("a completed, cancelled or rejected event's request cannot be approved", () => {
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

  it("a request for an event not yet approved cannot be approved, but can be rejected (SPM-54)", () => {
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

  it("a request for a retired venue cannot be approved", () => {
    expect(checkBookingDecision({ ...base, venue: { ...base.venue, isActive: false } })).toEqual({
      ok: false,
      error: "Orchard Seminar Room has been retired. Reject this request and suggest another venue.",
    });
  });
});

describe("conflicts at approval", () => {
  it("another approved booking in the same slots blocks, and is named", () => {
    expect(checkBookingDecision(withConfirmed(confirmed("2027-03-06T09:00:00", "2027-03-06T17:00:00")))).toEqual({
      ok: false,
      error:
        "This overlaps an approved booking: EVT-000042 Product Showcase holds Orchard Seminar Room on 6 Mar 2027 · AM, PM (07:00–18:00).",
    });
  });

  it("a clash only through setup or turnaround slots blocks too", () => {
    // The other booking holds 7 Mar AM, so its setup takes 6 Mar Night - the
    // slot this request's turnaround needs.
    expect(approvalConflict(base.venue, base.booking)).toBeNull();
    expect(
      approvalConflict(
        { ...base.venue, bookings: [confirmed("2027-03-07T09:00:00", "2027-03-07T11:00:00")] },
        base.booking
      )
    ).toBe(
      "This overlaps an approved booking: EVT-000042 Product Showcase holds Orchard Seminar Room on 7 Mar 2027 · AM (07:00–12:00). The clash is through a setup or turnaround slot."
    );
  });

  it("an approved booking far enough away does not block", () => {
    expect(checkBookingDecision(withConfirmed(confirmed("2027-03-08T09:00:00", "2027-03-08T17:00:00"))).ok).toBe(true);
  });

  it("the request never clashes with itself", () => {
    expect(
      checkBookingDecision(withConfirmed(confirmed("2027-03-06T07:00:00", "2027-03-06T18:00:00", "request"))).ok
    ).toBe(true);
  });

  it("a venue unavailability period blocks, with its reason", () => {
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
  it("a reason is required: empty or spaces-only is refused on the reason field", () => {
    for (const reason of ["", "   ", "\n\t "]) {
      expect(checkBookingDecision(reject(reason))).toEqual({
        ok: false,
        error: BOOKING_REJECTION_REASON_REQUIRED,
        field: "reason",
      });
    }
  });

  it("a request can be rejected with a reason alone", () => {
    expect(checkBookingDecision(reject("Hall closed for rigging work."))).toEqual({ ok: true });
  });

  it("rejecting is allowed where approving is not: a conflict, a closed event, a retired venue", () => {
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

  it("an alternative arrangement in words needs no venue", () => {
    expect(checkBookingDecision(reject(REASON, { suggestedAlternative: "The PM slot on 7 Mar is free." }))).toEqual({
      ok: true,
    });
  });

  it("another active venue can be suggested", () => {
    const input = { ...reject(REASON, { suggestedVenueId: "mar-aud" }), suggestedVenue: { id: "mar-aud", isActive: true } };
    expect(checkBookingDecision(input)).toEqual({ ok: true });
  });

  it("a suggested venue that does not exist or is retired is refused", () => {
    const expected = { ok: false, error: "Choose a venue from the catalogue to suggest.", field: "suggestedVenueId" };
    expect(checkBookingDecision({ ...reject(REASON, { suggestedVenueId: "gone" }), suggestedVenue: null })).toEqual(expected);
    expect(
      checkBookingDecision({
        ...reject(REASON, { suggestedVenueId: "old" }),
        suggestedVenue: { id: "old", isActive: false },
      })
    ).toEqual(expected);
  });

  it("the venue that was just refused cannot be the suggestion", () => {
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

  it("accepts an approval, and a rejection with or without a suggestion", () => {
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

  it("treats blank suggestion fields as not given", () => {
    expect(
      decideVenueBookingSchema.parse({ decision: "reject", reason: "No.", suggestedVenueId: "", suggestedAlternative: "  " })
    ).toEqual({ decision: "reject", reason: "No." });
  });

  it("lets a blank reason through for checkBookingDecision to refuse with the screen's message", () => {
    expect(decideVenueBookingSchema.safeParse({ decision: "reject", reason: "" }).success).toBe(true);
    expect(decideVenueBookingSchema.safeParse({ decision: "reject" }).success).toBe(false);
  });

  it("refuses an unknown decision, a malformed venue id, and a suggestion on an approval (#110)", () => {
    expect(decideVenueBookingSchema.safeParse({ decision: "hold" }).success).toBe(false);
    expect(decideVenueBookingSchema.safeParse({ decision: "reject", reason: "No.", suggestedVenueId: "MAR-AUD" }).success).toBe(false);
    expect(decideVenueBookingSchema.safeParse({ decision: "approve", suggestedVenueId: VENUE }).success).toBe(false);
  });
});
