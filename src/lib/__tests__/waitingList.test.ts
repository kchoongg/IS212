// SPM-66 - Join and Respond to Waiting List. The pure rules.

import { describe, expect, it } from "vitest";
import {
  OFFER_WINDOW_DAYS,
  WAITING_LIST_MESSAGES,
  freePlaces,
  hasStarted,
  isFullForNewcomers,
  joinRefusal,
  leaveRefusal,
  offerEndedNotice,
  offerExpiry,
  offerMadeNotice,
  offerStands,
  seatsHeld,
  waitingOrder,
  waitingPosition,
} from "@/lib/waitingList";

const sgt = (iso: string) => new Date(`${iso}+08:00`);
const NOW = sgt("2026-10-23T10:00:00");

describe("offerExpiry (AC6, AC10)", () => {
  it("[SPM-66][AC6] gives the attendee 3 days to accept", () => {
    expect(OFFER_WINDOW_DAYS).toBe(3);
    expect(offerExpiry(NOW, sgt("2026-12-01T09:00:00"))).toEqual(sgt("2026-10-26T10:00:00"));
  });

  it("[SPM-66][AC10] ends the offer when the event starts, if that is sooner", () => {
    expect(offerExpiry(NOW, sgt("2026-10-24T09:00:00"))).toEqual(sgt("2026-10-24T09:00:00"));
  });

  it("[SPM-66][AC6] gives the full 3 days when the event has no start", () => {
    expect(offerExpiry(NOW, null)).toEqual(sgt("2026-10-26T10:00:00"));
  });
});

describe("hasStarted (AC10)", () => {
  it.each([
    ["before its start", "2026-10-23T10:01:00", false],
    ["at its start", "2026-10-23T10:00:00", true],
    ["after its start", "2026-10-23T09:59:00", true],
  ])("[SPM-66][AC10] says an event %s has %s started", (_case, startsAt, started) => {
    expect(hasStarted(sgt(startsAt), NOW)).toBe(started);
  });

  it.each([null, undefined])("[SPM-66][AC10] treats an event with no start (%s) as started - nothing is offered", (startsAt) => {
    expect(hasStarted(startsAt, NOW)).toBe(true);
  });

  it("[SPM-66][AC10] reads a start sent as text", () => {
    expect(hasStarted("2026-12-01T01:00:00.000Z", NOW)).toBe(false);
  });
});

describe("places (AC1, AC5, AC8)", () => {
  it("[SPM-66][AC5] frees the places not taken or under offer", () => {
    expect(freePlaces(50, { taken: 47, underOffer: 1, waiting: 4 })).toBe(2);
  });

  it("[SPM-66][AC8] counts a place under offer as held", () => {
    expect(freePlaces(50, { taken: 49, underOffer: 1, waiting: 4 })).toBe(0);
  });

  it("[SPM-66][AC5] never goes below zero when the capacity was lowered", () => {
    expect(freePlaces(40, { taken: 45, underOffer: 0, waiting: 2 })).toBe(0);
  });

  it("[SPM-66][AC5] offers nothing when there is no capacity", () => {
    expect(freePlaces(null, { taken: 300, underOffer: 0, waiting: 0 })).toBe(0);
  });

  it.each([
    ["every place is taken", { taken: 50, underOffer: 0, waiting: 0 }, true],
    ["the last place is under offer", { taken: 49, underOffer: 1, waiting: 0 }, true],
    ["someone is still waiting, though a place is free", { taken: 48, underOffer: 0, waiting: 1 }, true],
    ["a place is free and nobody waits", { taken: 49, underOffer: 0, waiting: 0 }, false],
  ])("[SPM-66][AC1][AC8] is full for a newcomer when %s: %s", (_case, counts, full) => {
    expect(isFullForNewcomers(50, counts)).toBe(full);
  });

  it("[SPM-66][AC1] is never full without a capacity", () => {
    expect(isFullForNewcomers(null, { taken: 500, underOffer: 0, waiting: 3 })).toBe(false);
  });

  it("[SPM-66][AC8] reports the capacity as held while the event is full for newcomers", () => {
    expect(seatsHeld(50, { taken: 48, underOffer: 0, waiting: 1 })).toBe(50);
  });

  it("[SPM-66][AC8] reports taken and under offer otherwise", () => {
    expect(seatsHeld(50, { taken: 40, underOffer: 2, waiting: 0 })).toBe(42);
    expect(seatsHeld(null, { taken: 40, underOffer: 0, waiting: 0 })).toBe(40);
  });
});

describe("joinRefusal (AC1, AC2)", () => {
  it("[SPM-66][AC1] lets an attendee join a full event's list", () => {
    expect(joinRefusal({ kind: "full" }, null)).toBeNull();
  });

  it("[SPM-66][AC1] sends them to register while there are places", () => {
    expect(joinRefusal({ kind: "open" }, null)).toBe("This event still has places, so register instead.");
  });

  it.each([
    [{ kind: "closed", closesAt: NOW } as const, "Registration has closed"],
    [{ kind: "not_open", opensAt: NOW } as const, "Registration has not opened yet"],
    [{ kind: "disabled" } as const, "Registration is not enabled for this event"],
    [{ kind: "not_confirmed" } as const, "Event is not open for registration yet"],
  ])("[SPM-66][AC1] refuses while registration isn't open (%o)", (state, error) => {
    expect(joinRefusal(state, null)).toBe(error);
  });

  it.each(["registered", "attended"])("[SPM-66][AC2] refuses an attendee who is already %s", (status) => {
    expect(joinRefusal({ kind: "full" }, status)).toBe("You're already registered for this event.");
  });

  it("[SPM-66][AC2] refuses an attendee already on the list", () => {
    expect(joinRefusal({ kind: "full" }, "waitlisted")).toBe("You're already on the waiting list for this event.");
  });
});

describe("the queue (AC3, AC4, AC5)", () => {
  const rows = [
    { id: "c", waitlistedAt: sgt("2026-10-20T09:00:00"), registeredAt: sgt("2026-10-20T09:00:00") },
    { id: "a", waitlistedAt: sgt("2026-10-18T09:00:00"), registeredAt: sgt("2026-10-18T09:00:00") },
    { id: "b", waitlistedAt: null, registeredAt: sgt("2026-10-19T09:00:00") },
  ];

  it("[SPM-66][AC5] is first in, first out", () => {
    expect(waitingOrder(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("[SPM-66][AC5] breaks a tie by id, so the order never changes between reads", () => {
    const same = sgt("2026-10-18T09:00:00");
    const tied = [
      { id: "y", waitlistedAt: same, registeredAt: same },
      { id: "x", waitlistedAt: same, registeredAt: same },
    ];
    expect(waitingOrder(tied).map((r) => r.id)).toEqual(["x", "y"]);
  });

  it("[SPM-66][AC3] gives each attendee their position, counting from 1", () => {
    expect(waitingPosition(rows, "c")).toBe(3);
    expect(waitingPosition(rows, "nobody")).toBeNull();
  });

  it("[SPM-66][AC4] moves everyone behind up when someone leaves", () => {
    expect(waitingPosition(rows.filter((r) => r.id !== "a"), "c")).toBe(2);
  });
});

describe("leaveRefusal (AC4)", () => {
  it("[SPM-66][AC4] lets an attendee leave while the event is ahead", () => {
    expect(leaveRefusal({ status: "confirmed", endsAt: sgt("2026-12-01T17:00:00") }, NOW)).toBeNull();
  });

  it.each([
    ["cancelled", { status: "cancelled", endsAt: sgt("2026-12-01T17:00:00") }, "This event has been cancelled, so there is nothing to withdraw from"],
    ["completed", { status: "completed", endsAt: sgt("2026-10-01T17:00:00") }, "This event is over, so the registration can no longer be withdrawn"],
    ["over", { status: "confirmed", endsAt: sgt("2026-10-22T17:00:00") }, "This event is over, so the registration can no longer be withdrawn"],
  ])("[SPM-66][AC4] keeps the list of a %s event as it was", (_case, event, error) => {
    expect(leaveRefusal(event, NOW)).toBe(error);
  });
});

describe("offerStands (AC6)", () => {
  it("[SPM-66][AC6] stands until it ends", () => {
    expect(offerStands(sgt("2026-10-23T10:01:00"), NOW)).toBe(true);
    expect(offerStands("2026-10-26T02:00:00.000Z", NOW)).toBe(true);
  });

  it.each([sgt("2026-10-23T10:00:00"), null, undefined])("[SPM-66][AC6] does not stand at or after its end, or without one (%s)", (expiresAt) => {
    expect(offerStands(expiresAt, NOW)).toBe(false);
  });
});

describe("notifications (AC5, AC7, AC9, AC10)", () => {
  it("[SPM-66][AC5] tells the attendee a place is theirs, and until when", () => {
    expect(offerMadeNotice("SPM66 Harbour Summit", sgt("2026-10-26T10:00:00"))).toEqual({
      type: "waitlist_offer",
      title: "A place is available",
      body: 'A place is available for "SPM66 Harbour Summit". Accept it by 26 Oct 2026, 10:00, or it goes to the next person on the waiting list.',
    });
  });

  it.each([
    ["expired", "Your offer of a place for \"SPM66 Harbour Summit\" has ended because it wasn't accepted in time, and you have left the waiting list."],
    ["event_started", "Your offer of a place for \"SPM66 Harbour Summit\" has ended because the event has started. You're still on the waiting list."],
    ["moved", "The coordinator has offered the place for \"SPM66 Harbour Summit\" to someone else. You're still on the waiting list, in the same position."],
  ] as const)("[SPM-66][AC7][AC9][AC10] says why an offer ended (%s)", (reason, body) => {
    expect(offerEndedNotice("SPM66 Harbour Summit", reason)).toEqual({ type: "waitlist_offer_ended", title: "Your offer has ended", body });
  });

  it("[SPM-66] names 'an event' when there is no title", () => {
    expect(offerMadeNotice(null, NOW).body).toContain('"an event"');
    expect(offerEndedNotice(null, "moved").body).toContain('"an event"');
  });

  it("[SPM-66] words every refusal", () => {
    expect(WAITING_LIST_MESSAGES.offerEnded).toBe("This offer has ended.");
    expect(WAITING_LIST_MESSAGES.coordinatorOnly).toBe("Only the event's assigned coordinator can offer a place out of turn.");
  });
});
