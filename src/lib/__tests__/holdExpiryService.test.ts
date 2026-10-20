// SPM-82: the sweep that expires overdue holds and warns before they do. It
// runs whenever bookings are read, so it is what makes AC4 and AC9 happen.

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/prisma");

import { expireDueHolds } from "../holdExpiryService";
import { db } from "@/test/kit";

const sgt = (iso: string) => new Date(`${iso}+08:00`);
const NOW = sgt("2026-10-15T09:00:00");

/// The SQL text of the n-th raw query, with its interpolated values.
const sqlOf = (n: number) => {
  const [strings, ...values] = db.$queryRaw.mock.calls[n] as [TemplateStringsArray, ...unknown[]];
  return { text: strings.join("?").replace(/\s+/g, " "), values };
};

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "b1",
  eventId: "e1",
  recipientId: "c1",
  eventTitle: "SPM82 Lapsed Workshop",
  venueName: "SPM82 Hold Room",
  venueCode: "SPM82-HOLD",
  holdExpiresAt: sgt("2026-10-15T08:00:00"),
  ...overrides,
});

afterEach(() => {
  delete process.env.VENUE_HOLD_WARNING_HOURS;
});

describe("expireDueHolds", () => {
  it("[SPM-82][AC4] does nothing else when no hold is due", async () => {
    const result = await expireDueHolds(db as never, NOW);

    expect(result).toEqual({ warned: 0, expired: 0 });
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it("[SPM-82][AC4] AC4: marks every pending hold past its expiry as expired, and only those", async () => {
    await expireDueHolds(db as never, NOW);

    const { text, values } = sqlOf(1);
    expect(text).toContain("UPDATE venue_bookings");
    expect(text).toContain("SET status = 'expired'");
    expect(text).toContain("b.status = 'pending'");
    expect(text).toContain("b.hold_expires_at <= ?");
    expect(values).toContain(NOW);
  });

  it("[SPM-82][AC11] AC11: never touches an approved booking - only pending holds are swept", async () => {
    await expireDueHolds(db as never, NOW);

    for (const n of [0, 1]) expect(sqlOf(n).text).not.toContain("'approved'");
  });

  it("[SPM-82][AC9] AC9: tells each expired hold's coordinator once, saying the venue was released", async () => {
    db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([row(), row({ id: "b2", recipientId: "c2", eventId: "e2" })]);

    const result = await expireDueHolds(db as never, NOW);

    expect(result).toEqual({ warned: 0, expired: 2 });
    expect(db.notification.createMany).toHaveBeenCalledTimes(1);
    const { data } = db.notification.createMany.mock.calls[0][0];
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ recipientId: "c1", eventId: "e1", type: "venue_hold_expired", title: "Venue hold expired" });
    expect(data[1]).toMatchObject({ recipientId: "c2", eventId: "e2" });
  });

  it("[SPM-82][AC9] AC9: warns once, within 24 hours of expiry by default, about holds not yet warned", async () => {
    db.$queryRaw.mockResolvedValueOnce([row({ holdExpiresAt: sgt("2026-10-15T21:00:00") })]).mockResolvedValueOnce([]);

    const result = await expireDueHolds(db as never, NOW);

    expect(result).toEqual({ warned: 1, expired: 0 });
    const { text, values } = sqlOf(0);
    expect(text).toContain("SET expiry_warning_sent_at = ?");
    expect(text).toContain("b.expiry_warning_sent_at IS NULL");
    expect(text).toContain("b.hold_expires_at > ?");
    expect(text).toContain("b.hold_expires_at <= ?");
    expect(values).toContainEqual(sgt("2026-10-16T09:00:00")); // now + 24h
    expect(db.notification.createMany.mock.calls[0][0].data[0]).toMatchObject({
      recipientId: "c1",
      type: "venue_hold_expiring",
      title: "Venue hold expires soon",
    });
  });

  it("[SPM-82][AC9] AC9: uses the configured warning period", async () => {
    process.env.VENUE_HOLD_WARNING_HOURS = "48";

    await expireDueHolds(db as never, NOW);

    expect(sqlOf(0).values).toContainEqual(sgt("2026-10-17T09:00:00"));
  });

  it("[SPM-82][AC4][AC9] warns before it expires, so a hold past due in the same sweep is expired, not warned", async () => {
    await expireDueHolds(db as never, NOW);

    // The warning only covers holds still in the future (> now); the expiry
    // statement runs second and takes the rest.
    expect(sqlOf(0).text).toContain("SET expiry_warning_sent_at");
    expect(sqlOf(1).text).toContain("SET status = 'expired'");
  });

  it("[SPM-82][AC9] notifies the event's coordinator, or whoever made the request when it has none", async () => {
    await expireDueHolds(db as never, NOW);

    for (const n of [0, 1]) expect(sqlOf(n).text).toContain('COALESCE(e.coordinator_id, b.requested_by) AS "recipientId"');
  });
});
