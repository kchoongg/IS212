import { describe, it, expect } from "vitest";
import {
  EXPIRED_HOLD_MESSAGE,
  HOLD_DAYS,
  checkHoldExpiryChange,
  defaultHoldExpiry,
  holdExpiredNotification,
  holdExpiringNotification,
  warningHours,
} from "../holdExpiry";

// SPM-82 (Week 7 change #4): a tentative hold - a pending venue booking
// request (#41) - expires if Venue Staff have not approved it in time.
// Singapore time throughout, written with +08:00 so each value reads as shown.

const sgt = (iso: string) => new Date(`${iso}+08:00`);

describe("defaultHoldExpiry (AC2)", () => {
  it("[SPM-82][AC2] holds for 7 days from the request", () => {
    expect(HOLD_DAYS).toBe(7);
    expect(defaultHoldExpiry(sgt("2026-10-15T14:30:00"), sgt("2027-03-08T09:00:00"))).toEqual(
      sgt("2026-10-22T14:30:00")
    );
  });

  it("[SPM-82][AC2] boundary: stops at the start of an event that begins sooner than 7 days away", () => {
    expect(defaultHoldExpiry(sgt("2026-10-15T14:30:00"), sgt("2026-10-18T10:00:00"))).toEqual(
      sgt("2026-10-18T10:00:00")
    );
  });

  it("[SPM-82][AC2] boundary: an event starting exactly 7 days later gives the same time either way", () => {
    expect(defaultHoldExpiry(sgt("2026-10-15T09:00:00"), sgt("2026-10-22T09:00:00"))).toEqual(
      sgt("2026-10-22T09:00:00")
    );
  });

  it("[SPM-82][AC2] holds for 7 days when the event has no start yet", () => {
    expect(defaultHoldExpiry(sgt("2026-10-15T09:00:00"), null)).toEqual(sgt("2026-10-22T09:00:00"));
  });
});

describe("checkHoldExpiryChange (AC3)", () => {
  const now = sgt("2026-10-15T09:00:00");
  const eventStartsAt = sgt("2027-02-08T09:00:00");
  const change = (overrides: Partial<Parameters<typeof checkHoldExpiryChange>[0]> = {}) =>
    checkHoldExpiryChange({ status: "pending", newExpiry: sgt("2027-01-20T09:00:00"), eventStartsAt, now, ...overrides });

  it("[SPM-82][AC3] allows moving an active hold's expiry to any time before the event starts", () => {
    expect(change()).toEqual({ ok: true });
  });

  it("[SPM-82][AC2][AC3] boundary: allows exactly the event's start", () => {
    expect(change({ newExpiry: eventStartsAt })).toEqual({ ok: true });
  });

  it("[SPM-82][AC2][AC3] boundary: refuses one minute after the event's start, naming it", () => {
    expect(change({ newExpiry: sgt("2027-02-08T09:01:00") })).toEqual({
      ok: false,
      error: "The expiry cannot be later than the start of the event (8 Feb 2027, 09:00).",
    });
  });

  it("[SPM-82][AC3] refuses a time that has already passed, and now itself", () => {
    for (const newExpiry of [sgt("2026-01-01T09:00:00"), now]) {
      expect(change({ newExpiry })).toEqual({ ok: false, error: "The expiry must be in the future." });
    }
  });

  it("[SPM-82][AC3] words the expired-hold refusal the same way everywhere it is used", () => {
    expect(EXPIRED_HOLD_MESSAGE).toBe("This hold has expired. The Coordinator must submit a new request.");
  });

  it("[SPM-82][AC3] refuses a hold that has already expired - only an active one can change", () => {
    expect(change({ status: "expired" })).toEqual({ ok: false, error: EXPIRED_HOLD_MESSAGE });
  });

  it("[SPM-82][AC11] AC11: refuses an approved booking, which never expires", () => {
    expect(change({ status: "approved" })).toEqual({ ok: false, error: "An approved booking does not expire." });
  });

  it.each(["rejected", "withdrawn", "released"])("[SPM-82][AC3] refuses a %s request, which holds nothing", (status) => {
    expect(change({ status })).toEqual({ ok: false, error: "Only a pending hold has an expiry to change." });
  });

  it("[SPM-82][AC3] puts no upper limit on an event with no start", () => {
    expect(change({ eventStartsAt: null, newExpiry: sgt("2030-01-01T09:00:00") })).toEqual({ ok: true });
  });
});

describe("warningHours (AC9, 'configurable')", () => {
  it("[SPM-82][AC9] defaults to 24 hours", () => {
    expect(warningHours(undefined)).toBe(24);
    expect(warningHours("")).toBe(24);
  });

  it("[SPM-82][AC9] takes the configured number of hours", () => {
    expect(warningHours("48")).toBe(48);
    expect(warningHours("1.5")).toBe(1.5);
  });

  it.each(["0", "-6", "soon", "Infinity"])("[SPM-82][AC9] falls back to 24 for %j", (raw) => {
    expect(warningHours(raw)).toBe(24);
  });
});

describe("hold notifications (AC9)", () => {
  const row = {
    recipientId: "c1",
    eventId: "e1",
    eventTitle: "SPM82 Lapsed Workshop",
    venueName: "SPM82 Hold Room",
    venueCode: "SPM82-HOLD",
    holdExpiresAt: sgt("2026-10-01T09:00:00"),
  };

  it("[SPM-82][AC9] warns ahead of time, saying when", () => {
    expect(holdExpiringNotification(row)).toEqual({
      type: "venue_hold_expiring",
      title: "Venue hold expires soon",
      body: 'The hold on SPM82 Hold Room (SPM82-HOLD) for "SPM82 Lapsed Workshop" expires on 1 Oct 2026, 09:00. Ask Venue Staff to approve it before then, or the venue will be released.',
      eventId: "e1",
    });
  });

  it("[SPM-82][AC9] says the venue was released once it has expired", () => {
    expect(holdExpiredNotification(row)).toEqual({
      type: "venue_hold_expired",
      title: "Venue hold expired",
      body: 'The hold on SPM82 Hold Room (SPM82-HOLD) for "SPM82 Lapsed Workshop" expired on 1 Oct 2026, 09:00, and the venue has been released. Submit a new request if you still need it.',
      eventId: "e1",
    });
  });

  it("[SPM-82][AC9] names an untitled event as such", () => {
    expect(holdExpiredNotification({ ...row, eventTitle: null }).body).toContain('for "Untitled event"');
  });
});
