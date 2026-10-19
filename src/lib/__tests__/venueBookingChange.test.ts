import { describe, it, expect } from "vitest";
import {
  ALREADY_APPROVED_MESSAGE,
  CLOSED_EVENT_CHANGE_MESSAGE,
  NOT_APPROVED_YET_MESSAGE,
  NOT_RELEASABLE_MESSAGE,
  NOT_WITHDRAWABLE_MESSAGE,
  canChangeBookingsOf,
  checkBookingChange,
  releaseNotification,
} from "../venueBookingChange";
import { changeVenueBookingSchema } from "../validation";

// SPM-67 (Withdraw or Release Venue Booking). The assigned Coordinator
// withdraws a request that is still pending (AC1) or releases a booking Venue
// Staff approved (AC3). Who may do it is the route's question; these are the
// rules about the booking and its event.

describe("checkBookingChange", () => {
  it("[SPM-67][AC1] SPM-67-TC01: withdraws a pending request", () => {
    expect(checkBookingChange({ action: "withdraw", bookingStatus: "pending", eventStatus: "planning" })).toEqual({
      ok: true,
      status: "withdrawn",
    });
  });

  it("[SPM-67][AC3] SPM-67-TC03: releases an approved booking", () => {
    expect(checkBookingChange({ action: "release", bookingStatus: "approved", eventStatus: "planning" })).toEqual({
      ok: true,
      status: "released",
    });
  });

  it("[SPM-67][AC1] refuses to withdraw a request Venue Staff have already approved, and says to release it", () => {
    expect(checkBookingChange({ action: "withdraw", bookingStatus: "approved", eventStatus: "planning" })).toEqual({
      ok: false,
      error: ALREADY_APPROVED_MESSAGE,
    });
  });

  it("[SPM-67][AC3] refuses to release a request that is still pending, and says to withdraw it", () => {
    expect(checkBookingChange({ action: "release", bookingStatus: "pending", eventStatus: "planning" })).toEqual({
      ok: false,
      error: NOT_APPROVED_YET_MESSAGE,
    });
  });

  it.each(["rejected", "withdrawn", "released"])("[SPM-67][AC1] refuses to withdraw a %s booking", (bookingStatus) => {
    expect(checkBookingChange({ action: "withdraw", bookingStatus, eventStatus: "planning" })).toEqual({
      ok: false,
      error: NOT_WITHDRAWABLE_MESSAGE,
    });
  });

  it.each(["rejected", "withdrawn", "released"])("[SPM-67][AC3] refuses to release a %s booking", (bookingStatus) => {
    expect(checkBookingChange({ action: "release", bookingStatus, eventStatus: "planning" })).toEqual({
      ok: false,
      error: NOT_RELEASABLE_MESSAGE,
    });
  });

  it.each(["completed", "cancelled", "rejected", "withdrawn"])("[SPM-67] changes nothing on a %s event", (eventStatus) => {
    expect(checkBookingChange({ action: "release", bookingStatus: "approved", eventStatus })).toEqual({
      ok: false,
      error: CLOSED_EVENT_CHANGE_MESSAGE,
    });
  });

  it.each(["submitted", "under_review", "approved", "planning", "safety_review", "confirmed", "postponed"])(
    "[SPM-67] allows a change on a %s event, which keeps its status",
    (eventStatus) => {
      expect(checkBookingChange({ action: "release", bookingStatus: "approved", eventStatus }).ok).toBe(true);
    }
  );
});

describe("canChangeBookingsOf", () => {
  it("[SPM-67] is true for an event still going ahead", () => {
    expect(canChangeBookingsOf("confirmed")).toBe(true);
  });

  it("[SPM-67] is false for a closed event", () => {
    expect(canChangeBookingsOf("completed")).toBe(false);
  });
});

describe("releaseNotification", () => {
  const base = {
    coordinatorName: "Daniel Tan",
    venueName: "SPM67 Hall",
    venueCode: "SPM67-HAL",
    eventId: "event-id",
    eventReference: "EVT-000123",
    eventTitle: "SPM67 Release Pair",
    sessionLabel: null,
    // 4 Nov 2027, 09:00-12:00 in Singapore.
    startsAt: new Date("2027-11-04T01:00:00.000Z"),
    endsAt: new Date("2027-11-04T04:00:00.000Z"),
    reason: null,
  };

  it("[SPM-67][AC7] SPM-67-TC03: tells Venue Staff who released which room, for which event and when", () => {
    expect(releaseNotification(base)).toEqual({
      type: "venue_booking_released",
      title: "Venue booking released",
      body: "Daniel Tan released SPM67 Hall (SPM67-HAL) for EVT-000123 SPM67 Release Pair on 4 Nov 2027, 09:00–12:00.",
      eventId: "event-id",
    });
  });

  it("[SPM-67][AC7] adds the Coordinator's reason when one was given", () => {
    expect(releaseNotification({ ...base, reason: "Plenary moved to the client's own auditorium." }).body).toBe(
      "Daniel Tan released SPM67 Hall (SPM67-HAL) for EVT-000123 SPM67 Release Pair on 4 Nov 2027, 09:00–12:00. " +
        "Reason: Plenary moved to the client's own auditorium."
    );
  });

  it("[SPM-67][AC7] names the session of a multi-session event", () => {
    expect(releaseNotification({ ...base, sessionLabel: "Day 1" }).body).toBe(
      "Daniel Tan released SPM67 Hall (SPM67-HAL) for EVT-000123 SPM67 Release Pair (Day 1) on 4 Nov 2027, 09:00–12:00."
    );
  });
});

describe("changeVenueBookingSchema", () => {
  it("[SPM-67][AC5] accepts a withdrawal or release, with or without a reason", () => {
    expect(changeVenueBookingSchema.parse({ action: "withdraw" })).toEqual({ action: "withdraw" });
    expect(changeVenueBookingSchema.parse({ action: "release", reason: "  Not needed.  " })).toEqual({
      action: "release",
      reason: "Not needed.",
    });
  });

  it("[SPM-67][AC5] SPM-67-TC06: treats a blank reason as none", () => {
    expect(changeVenueBookingSchema.parse({ action: "withdraw", reason: "   " })).toEqual({ action: "withdraw" });
  });

  it("[SPM-67][AC5] accepts a reason of 2,000 characters and refuses 2,001", () => {
    expect(changeVenueBookingSchema.safeParse({ action: "withdraw", reason: "a".repeat(2000) }).success).toBe(true);
    expect(changeVenueBookingSchema.safeParse({ action: "withdraw", reason: "a".repeat(2001) }).success).toBe(false);
  });

  it("[SPM-67] refuses any other action", () => {
    expect(changeVenueBookingSchema.safeParse({ action: "approve" }).success).toBe(false);
  });
});
