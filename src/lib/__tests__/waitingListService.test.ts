// SPM-66: the waiting list applied to the database - offering free places
// first in, first out, and the sweep that ends offers whose time is up.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma");

import { offerFreePlaces, placeCounts, positionOnWaitingList, sweepWaitingList } from "../waitingListService";
import { db } from "@/test/kit";

const sgt = (iso: string) => new Date(`${iso}+08:00`);
const NOW = sgt("2026-10-23T10:00:00");
const EVENT = { title: "SPM66 Harbour Summit", status: "confirmed", startsAt: sgt("2026-12-01T09:00:00"), registrationCapacity: 50 };

/// The SQL text of the n-th raw query, with its values.
const sqlOf = (n: number) => {
  const [strings, ...values] = db.$queryRaw.mock.calls[n] as [TemplateStringsArray, ...unknown[]];
  return { text: strings.join("?").replace(/\s+/g, " "), values };
};

/// taken, under offer, waiting - the order placeCounts() asks.
function givenCounts(taken: number, underOffer: number, waiting: number) {
  db.registration.count.mockResolvedValueOnce(taken).mockResolvedValueOnce(underOffer).mockResolvedValueOnce(waiting);
}

const waiting = (id: string, joined: string, attendeeId = `att-${id}`) => ({
  id,
  attendeeId,
  waitlistedAt: sgt(joined),
  registeredAt: sgt(joined),
});

describe("placeCounts", () => {
  it("[SPM-66][AC8] counts places taken, under offer and still waiting", async () => {
    givenCounts(47, 1, 4);

    expect(await placeCounts(db as never, "e1", NOW)).toEqual({ taken: 47, underOffer: 1, waiting: 4 });
    expect(db.registration.count.mock.calls.map(([arg]) => arg.where)).toEqual([
      { eventId: "e1", status: { in: ["registered", "attended"] } },
      { eventId: "e1", status: "waitlisted", offerExpiresAt: { gt: NOW } },
      { eventId: "e1", status: "waitlisted", offerExpiresAt: null },
    ]);
  });
});

describe("offerFreePlaces", () => {
  it("[SPM-66][AC5] SPM-66-TC05: offers each free place to the earliest attendee waiting, for 3 days, and tells them", async () => {
    db.event.findUnique.mockResolvedValue(EVENT);
    givenCounts(48, 0, 3);
    db.registration.findMany.mockResolvedValue([
      waiting("late", "2026-10-21T09:00:00"),
      waiting("first", "2026-10-19T09:00:00"),
      waiting("second", "2026-10-20T09:00:00"),
    ]);

    expect(await offerFreePlaces(db as never, "e1", NOW)).toBe(2);

    expect(db.registration.update.mock.calls.map(([arg]) => arg)).toEqual([
      { where: { id: "first" }, data: { offeredAt: NOW, offerExpiresAt: sgt("2026-10-26T10:00:00"), offerEndedReason: null } },
      { where: { id: "second" }, data: { offeredAt: NOW, offerExpiresAt: sgt("2026-10-26T10:00:00"), offerEndedReason: null } },
    ]);
    expect(db.notification.create.mock.calls.map(([arg]) => arg.data.recipientId)).toEqual(["att-first", "att-second"]);
    expect(db.notification.create.mock.calls[0][0].data).toMatchObject({ type: "waitlist_offer", eventId: "e1" });
  });

  it("[SPM-66][AC5] locks the event's row before counting", async () => {
    db.event.findUnique.mockResolvedValue(EVENT);
    givenCounts(50, 0, 0);

    await offerFreePlaces(db as never, "e1", NOW);

    expect(sqlOf(0).text).toBe("SELECT id FROM events WHERE id = ? FOR UPDATE");
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.registration.count.mock.invocationCallOrder[0]);
  });

  it("[SPM-66][AC5] offers nothing while every place is taken or under offer", async () => {
    db.event.findUnique.mockResolvedValue(EVENT);
    givenCounts(49, 1, 3);

    expect(await offerFreePlaces(db as never, "e1", NOW)).toBe(0);
    expect(db.registration.update).not.toHaveBeenCalled();
  });

  it("[SPM-66][AC10] makes no offer once the event has started", async () => {
    db.event.findUnique.mockResolvedValue({ ...EVENT, startsAt: sgt("2026-10-23T09:00:00") });

    expect(await offerFreePlaces(db as never, "e1", NOW)).toBe(0);
    expect(db.registration.count).not.toHaveBeenCalled();
  });

  it.each([["not Confirmed", { status: "postponed" }], ["missing", null]])(
    "[SPM-66][AC5] makes no offer for an event that is %s",
    async (_case, override) => {
      db.event.findUnique.mockResolvedValue(override && { ...EVENT, ...override });

      expect(await offerFreePlaces(db as never, "e1", NOW)).toBe(0);
    }
  );

  it("[SPM-66][AC10] ends the offer at the event's start when that is under 3 days away", async () => {
    db.event.findUnique.mockResolvedValue({ ...EVENT, startsAt: sgt("2026-10-24T09:00:00") });
    givenCounts(49, 0, 1);
    db.registration.findMany.mockResolvedValue([waiting("only", "2026-10-19T09:00:00")]);

    await offerFreePlaces(db as never, "e1", NOW);

    expect(db.registration.update.mock.calls[0][0].data.offerExpiresAt).toEqual(sgt("2026-10-24T09:00:00"));
  });

  it("[SPM-66][AC5] offers nothing when nobody is waiting", async () => {
    db.event.findUnique.mockResolvedValue(EVENT);
    givenCounts(48, 0, 0);
    db.registration.findMany.mockResolvedValue([]);

    expect(await offerFreePlaces(db as never, "e1", NOW)).toBe(0);
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("[SPM-66] uses the current time when none is given", async () => {
    db.event.findUnique.mockResolvedValue(null);

    expect(await offerFreePlaces(db as never, "e1")).toBe(0);
  });
});

describe("sweepWaitingList", () => {
  const row = (eventId: string, attendeeId: string) => ({ eventId, attendeeId, eventTitle: "SPM66 Harbour Summit" });

  it("[SPM-66][AC10] ends the offers of events that have started, keeping the attendee on the list", async () => {
    await sweepWaitingList(db as never, NOW);

    const { text, values } = sqlOf(0);
    expect(text).toContain("SET offer_expires_at = NULL, offer_ended_reason = 'event_started'");
    expect(text).toContain("r.status = 'waitlisted' AND r.offer_expires_at IS NOT NULL AND e.starts_at <= ?");
    expect(text).not.toContain("withdrawn");
    expect(values).toEqual([NOW]);
  });

  it("[SPM-66][AC7] SPM-66-TC07: takes an attendee whose offer lapsed off the list", async () => {
    await sweepWaitingList(db as never, NOW);

    const { text, values } = sqlOf(1);
    expect(text).toContain("SET status = 'withdrawn', withdrawn_at = ?, offer_expires_at = NULL, offer_ended_reason = 'expired'");
    expect(text).toContain("r.status = 'waitlisted' AND r.offer_expires_at <= ?");
    expect(values).toEqual([NOW, NOW]);
  });

  it("[SPM-66][AC7][AC10] tells each attendee their offer ended, and why", async () => {
    db.$queryRaw.mockResolvedValueOnce([row("e1", "a1")]).mockResolvedValueOnce([row("e2", "a2")]);
    db.event.findUnique.mockResolvedValue(null);

    expect(await sweepWaitingList(db as never, NOW)).toEqual({ started: 1, expired: 1 });

    const data = callData();
    expect(data.map((n) => [n.recipientId, n.eventId, n.type])).toEqual([
      ["a1", "e1", "waitlist_offer_ended"],
      ["a2", "e2", "waitlist_offer_ended"],
    ]);
    expect(data[0].body).toContain("because the event has started");
    expect(data[1].body).toContain("wasn't accepted in time");
  });

  it("[SPM-66][AC7] offers each lapsed place to the next attendee, once per event", async () => {
    db.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row("e1", "a1"), row("e1", "a2")])
      .mockResolvedValue([]);
    db.event.findUnique.mockResolvedValue(null);

    await sweepWaitingList(db as never, NOW);

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(sqlOf(2).values).toEqual(["e1"]);
  });

  it("[SPM-66][AC7] does nothing else when no offer is due", async () => {
    db.$queryRaw.mockResolvedValue([]);

    expect(await sweepWaitingList(db as never, NOW)).toEqual({ started: 0, expired: 0 });
    expect(db.notification.createMany).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("[SPM-66] uses the shared client and the current time by default", async () => {
    expect(await sweepWaitingList()).toEqual({ started: 0, expired: 0 });
  });
});

describe("positionOnWaitingList", () => {
  it("[SPM-66][AC3] counts the attendee's place among those still waiting", async () => {
    db.registration.findMany.mockResolvedValue([waiting("b", "2026-10-20T09:00:00"), waiting("a", "2026-10-19T09:00:00")]);

    expect(await positionOnWaitingList(db as never, "e1", "b")).toBe(2);
    expect(db.registration.findMany.mock.calls[0][0].where).toEqual({ eventId: "e1", status: "waitlisted" });
  });
});

function callData(): { recipientId: string; eventId: string; type: string; body: string }[] {
  return db.notification.createMany.mock.calls[0][0].data;
}
