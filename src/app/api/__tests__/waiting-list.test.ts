// SPM-66 - Join and Respond to Waiting List: the routes.
//
//   POST /api/events/[id]/waiting-list             join (AC1, AC2)
//   PATCH /api/registrations/[id] {withdrawn}      leave (AC4), and a freed seat is offered (AC5)
//   POST /api/registrations/[id]/offer {response}  accept (AC6) or decline (AC7)
//   POST /api/events/[id]/waiting-list/offers      the coordinator's override (AC9)
//   PATCH /api/events/[id]/registration            a raised capacity is offered (AC5)

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/prisma");

import { POST as join } from "@/app/api/events/[id]/waiting-list/route";
import { POST as override } from "@/app/api/events/[id]/waiting-list/offers/route";
import { POST as respond } from "@/app/api/registrations/[id]/offer/route";
import { PATCH as withdraw } from "@/app/api/registrations/[id]/route";
import { PATCH as configure } from "@/app/api/events/[id]/registration/route";
import { GET as eventDetail } from "@/app/api/events/[id]/route";
import { GET as myRegistrations } from "@/app/api/registrations/route";
import { GET as registrationList } from "@/app/api/events/[id]/registrations/route";
import { GET as unreadCount } from "@/app/api/notifications/unread-count/route";
import { callArg, db, ID, params, req, signIn, user, waitingListSweepOrder } from "@/test/kit";

const REF = "EVT-000066";
const sgt = (iso: string) => new Date(`${iso}+08:00`);
const NOW = sgt("2026-10-23T10:00:00");
const IN_3_DAYS = sgt("2026-10-26T10:00:00");

/// A full, Confirmed event open for registration, assigned to ID.otherUser.
function event(overrides: Record<string, unknown> = {}) {
  return {
    id: ID.event,
    sequenceNumber: 66,
    title: "SPM66 Harbour Summit",
    status: "confirmed",
    organiserId: ID.thirdUser,
    organisationId: ID.org,
    coordinatorId: ID.otherUser,
    startsAt: sgt("2026-12-01T09:00:00"),
    endsAt: sgt("2026-12-01T17:00:00"),
    registrationEnabled: true,
    registrationCapacity: 2,
    registrationOpensAt: sgt("2026-09-01T09:00:00"),
    registrationClosesAt: sgt("2026-11-30T17:00:00"),
    ...overrides,
  };
}

const attendee = () => user("attendee", { id: ID.user });
const coordinator = () => user("coordinator", { id: ID.otherUser });

/// taken, under offer, waiting - the order placeCounts() asks.
function givenCounts(taken: number, underOffer: number, waiting: number) {
  db.registration.count.mockResolvedValueOnce(taken).mockResolvedValueOnce(underOffer).mockResolvedValueOnce(waiting);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/events/[id]/waiting-list - joining", () => {
  const post = (token?: string, body: unknown = {}, reference = REF) =>
    join(req("POST", `/api/events/${reference}/waiting-list`, { token, body }), params({ id: reference }));

  it("[SPM-66][AC1] is 401 without a session", async () => {
    expect((await post()).status).toBe(401);
  });

  it.each(["organiser", "coordinator", "ops_manager"])("[SPM-66][AC1] refuses %s - only an Attendee waits", async (role) => {
    const res = await post(signIn(user(role)));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only an Attendee can join a waiting list" });
  });

  it.each([["a malformed reference", "nope", undefined], ["an event the attendee can't see", REF, { status: "planning" }]])(
    "[SPM-66][AC1] is 404 for %s",
    async (_case, reference, override) => {
      db.event.findUnique.mockResolvedValue(event(override));

      expect((await post(signIn(attendee()), {}, reference)).status).toBe(404);
    }
  );

  it("[SPM-66][AC1] SPM-66-TC01: puts the attendee at the back of a full event's list, with their needs", async () => {
    db.event.findUnique.mockResolvedValue(event());
    givenCounts(2, 0, 1);
    db.registration.findUnique.mockResolvedValue(null);
    db.registration.create.mockImplementation(async ({ data }: { data: object }) => ({ id: "r9", ...data }));

    const res = await post(signIn(attendee()), { dietaryRequirements: " Vegetarian ", accessibilityRequirements: "" });

    expect(res.status).toBe(201);
    expect(callArg(db.registration.create).data).toEqual({
      eventId: ID.event,
      attendeeId: ID.user,
      status: "waitlisted",
      waitlistedAt: NOW,
      registeredAt: NOW,
      withdrawnAt: null,
      offeredAt: null,
      offerExpiresAt: null,
      offerEndedReason: null,
      dietaryRequirements: "Vegetarian",
      accessibilityRequirements: null,
    });
  });

  it("[SPM-66][AC1] locks the event before counting, as registering does", async () => {
    db.event.findUnique.mockResolvedValue(event());
    givenCounts(2, 0, 0);
    db.registration.findUnique.mockResolvedValue(null);

    await post(signIn(attendee()));

    const [sql] = db.$queryRaw.mock.calls[0] as [string[]];
    expect(sql.join("?")).toBe("SELECT id FROM events WHERE id = ? FOR UPDATE");
  });

  it("[SPM-66][AC1][AC4] puts an attendee who left back on their old row, at the back", async () => {
    db.event.findUnique.mockResolvedValue(event());
    givenCounts(2, 0, 1);
    db.registration.findUnique.mockResolvedValue({ id: "old", status: "withdrawn" });
    db.registration.update.mockImplementation(async ({ data }: { data: object }) => ({ id: "old", ...data }));

    expect((await post(signIn(attendee()))).status).toBe(201);
    expect(callArg(db.registration.update)).toMatchObject({ where: { id: "old" }, data: { status: "waitlisted", waitlistedAt: NOW } });
    expect(db.registration.create).not.toHaveBeenCalled();
  });

  it("[SPM-66][AC1] sends the attendee to register while there are places", async () => {
    db.event.findUnique.mockResolvedValue(event());
    givenCounts(1, 0, 0);
    db.registration.findUnique.mockResolvedValue(null);

    const res = await post(signIn(attendee()));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This event still has places, so register instead." });
    expect(db.registration.create).not.toHaveBeenCalled();
  });

  it("[SPM-66][AC1] refuses once registration has closed", async () => {
    db.event.findUnique.mockResolvedValue(event({ registrationClosesAt: sgt("2026-10-22T17:00:00") }));
    givenCounts(2, 0, 0);
    db.registration.findUnique.mockResolvedValue(null);

    const res = await post(signIn(attendee()));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Registration has closed" });
  });

  it.each([
    ["registered", "You're already registered for this event."],
    ["waitlisted", "You're already on the waiting list for this event."],
  ])("[SPM-66][AC2] SPM-66-TC02: refuses an attendee who is already %s", async (status, error) => {
    db.event.findUnique.mockResolvedValue(event());
    givenCounts(2, 0, 1);
    db.registration.findUnique.mockResolvedValue({ id: "mine", status });

    const res = await post(signIn(attendee()));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(db.registration.update).not.toHaveBeenCalled();
  });

  it("[SPM-66] refuses anything but the attendee's needs", async () => {
    db.event.findUnique.mockResolvedValue(event());

    expect((await post(signIn(attendee()), { status: "registered" })).status).toBe(400);
  });

  it("[SPM-66] answers 500 when the database fails", async () => {
    db.event.findUnique.mockRejectedValue(new Error("connection lost"));

    expect((await post(signIn(attendee()))).status).toBe(500);
  });
});

describe("PATCH /api/registrations/[id] - leaving the list, and the place freed", () => {
  const patch = (token?: string) =>
    withdraw(req("PATCH", `/api/registrations/${ID.registration}`, { token, body: { status: "withdrawn" } }), params({ id: ID.registration }));

  function given(status: string, offerExpiresAt: Date | null = null, eventOverrides: Record<string, unknown> = {}) {
    db.registration.findUnique.mockResolvedValue({
      id: ID.registration,
      eventId: ID.event,
      attendeeId: ID.user,
      status,
      offerExpiresAt,
      event: { status: "confirmed", endsAt: sgt("2026-12-01T17:00:00"), ...eventOverrides },
    });
    db.registration.updateMany.mockResolvedValue({ count: 1 });
  }

  it("[SPM-66][AC4] SPM-66-TC03: takes a waiting attendee off the list, offering nothing - no place was theirs", async () => {
    given("waitlisted");

    expect((await patch(signIn(attendee()))).status).toBe(200);
    expect(callArg(db.registration.updateMany)).toEqual({
      where: { id: ID.registration, status: "waitlisted" },
      data: { status: "withdrawn", withdrawnAt: NOW },
    });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("[SPM-66][AC4][AC5] ends the offer of an attendee who leaves holding one, and offers it on", async () => {
    given("waitlisted", IN_3_DAYS);
    db.event.findUnique.mockResolvedValue(null);

    await patch(signIn(attendee()));

    expect(callArg(db.registration.updateMany).data).toEqual({
      status: "withdrawn",
      withdrawnAt: NOW,
      offerExpiresAt: null,
      offerEndedReason: "left",
    });
    const [sql, eventId] = db.$queryRaw.mock.calls[0] as [string[], string];
    expect(sql.join("?")).toContain("FOR UPDATE");
    expect(eventId).toBe(ID.event);
  });

  it("[SPM-66][AC5] SPM-66-TC05: offers a seat given back by a registered attendee to the next one waiting", async () => {
    given("registered");
    db.event.findUnique.mockResolvedValue(event());
    givenCounts(1, 0, 1);
    db.registration.findMany.mockResolvedValue([{ id: "next", attendeeId: "att-next", waitlistedAt: NOW, registeredAt: NOW }]);

    await patch(signIn(attendee()));

    expect(callArg(db.registration.update)).toMatchObject({ where: { id: "next" }, data: { offerExpiresAt: IN_3_DAYS } });
    expect(callArg(db.notification.create).data).toMatchObject({ recipientId: "att-next", type: "waitlist_offer" });
  });

  it("[SPM-66][AC4] keeps the list of an event that is over", async () => {
    given("waitlisted", null, { status: "completed", endsAt: sgt("2026-10-01T17:00:00") });

    const res = await patch(signIn(attendee()));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This event is over, so the registration can no longer be withdrawn" });
    expect(db.registration.updateMany).not.toHaveBeenCalled();
  });

  it("[SPM-66][AC4] offers nothing when a double click changed nothing", async () => {
    given("registered");
    db.registration.updateMany.mockResolvedValue({ count: 0 });

    expect((await patch(signIn(attendee()))).status).toBe(400);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("POST /api/registrations/[id]/offer - answering an offer", () => {
  const post = (token?: string, body: unknown = { response: "accept" }) =>
    respond(req("POST", `/api/registrations/${ID.registration}/offer`, { token, body }), params({ id: ID.registration }));

  function given(current: Record<string, unknown> = {}) {
    const row = { id: ID.registration, eventId: ID.event, attendeeId: ID.user, status: "waitlisted", offerExpiresAt: IN_3_DAYS };
    db.registration.findUnique
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({ ...row, event: { startsAt: sgt("2026-12-01T09:00:00") }, ...current });
    db.registration.update.mockImplementation(async ({ data }: { data: object }) => ({ ...row, ...data }));
  }

  it("[SPM-66][AC6] is 401 without a session", async () => {
    expect((await post()).status).toBe(401);
  });

  it("[SPM-66][AC6] refuses a role that holds no registrations", async () => {
    const res = await post(signIn(coordinator()));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only an Attendee can answer an offer of a place" });
  });

  it.each([["doesn't exist", null], ["is someone else's", { id: ID.registration, attendeeId: ID.thirdUser }]])(
    "[SPM-66][AC6] is 404 for a registration that %s",
    async (_case, row) => {
      db.registration.findUnique.mockResolvedValue(row);

      expect((await post(signIn(attendee()))).status).toBe(404);
    }
  );

  it("[SPM-66][AC6] SPM-66-TC04: registers an attendee who accepts in time, and takes them off the list", async () => {
    given();

    const res = await post(signIn(attendee()));

    expect(res.status).toBe(200);
    expect(callArg(db.registration.update)).toEqual({
      where: { id: ID.registration },
      data: { status: "registered", registeredAt: NOW, offerExpiresAt: null, offerEndedReason: null },
    });
  });

  it("[SPM-66][AC7] SPM-66-TC06: takes an attendee who declines off the list, and offers the place to the next", async () => {
    given();
    db.event.findUnique.mockResolvedValue(null);

    const res = await post(signIn(attendee()), { response: "decline" });

    expect(res.status).toBe(200);
    expect(callArg(db.registration.update).data).toEqual({
      status: "withdrawn",
      withdrawnAt: NOW,
      offerExpiresAt: null,
      offerEndedReason: "declined",
    });
    // The lock taken again by offerFreePlaces() for the next attendee.
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["no longer waiting", { status: "registered", offerExpiresAt: null }, "There is no place on offer to you for this event."],
    ["waiting with no offer", { offerExpiresAt: null }, "There is no place on offer to you for this event."],
    ["past its offer", { offerExpiresAt: sgt("2026-10-23T09:59:00") }, "This offer has ended."],
    ["after the event started", { event: { startsAt: sgt("2026-10-23T09:00:00") } }, "This offer has ended."],
  ])("[SPM-66][AC6][AC10] refuses an attendee %s", async (_case, current, error) => {
    given(current);

    const res = await post(signIn(attendee()));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(db.registration.update).not.toHaveBeenCalled();
  });

  it("[SPM-66] refuses an answer that is neither accept nor decline", async () => {
    given();

    expect((await post(signIn(attendee()), { response: "maybe" })).status).toBe(400);
  });

  it("[SPM-66] answers 500 when the database fails", async () => {
    db.registration.findUnique.mockRejectedValue(new Error("connection lost"));

    expect((await post(signIn(attendee()))).status).toBe(500);
  });
});

describe("POST /api/events/[id]/waiting-list/offers - the coordinator's override", () => {
  const post = (token?: string, body: unknown = { registrationId: ID.registration }, reference = REF) =>
    override(req("POST", `/api/events/${reference}/waiting-list/offers`, { token, body }), params({ id: reference }));

  const chosen = (overrides: Record<string, unknown> = {}) => ({
    id: ID.registration,
    eventId: ID.event,
    attendeeId: "att-chosen",
    status: "waitlisted",
    offerExpiresAt: null,
    ...overrides,
  });

  it("[SPM-66][AC9] is 401 without a session", async () => {
    expect((await post()).status).toBe(401);
  });

  it.each([["a malformed reference", "nope"], ["an event that doesn't exist", REF]])("[SPM-66][AC9] is 404 for %s", async (_case, reference) => {
    db.event.findUnique.mockResolvedValue(null);

    expect((await post(signIn(coordinator()), undefined, reference)).status).toBe(404);
  });

  it.each([
    ["another coordinator", () => user("coordinator", { id: ID.thirdUser })],
    ["the Event Coordinator Lead", () => user("ops_manager", { id: ID.thirdUser })],
    ["the organiser", () => user("organiser", { id: ID.thirdUser })],
  ])("[SPM-66][AC9] SPM-66-TC09: refuses %s", async (_who, actor) => {
    db.event.findUnique.mockResolvedValue(event());

    const res = await post(signIn(actor()));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only the event's assigned coordinator can offer a place out of turn." });
  });

  it("[SPM-66][AC9] SPM-66-TC08: moves the place under offer to the chosen attendee, and tells both", async () => {
    db.event.findUnique.mockResolvedValue(event());
    db.registration.findUnique.mockResolvedValue(chosen());
    db.registration.findFirst.mockResolvedValue({ id: "holder", attendeeId: "att-holder" });
    db.registration.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: object }) => ({ id: where.id, ...data }));

    const res = await post(signIn(coordinator()));

    expect(res.status).toBe(200);
    expect(callArg(db.registration.findFirst)).toEqual({
      where: { eventId: ID.event, status: "waitlisted", offerExpiresAt: { gt: NOW } },
      orderBy: { offeredAt: "desc" },
    });
    expect(db.registration.update.mock.calls.map(([arg]) => arg)).toEqual([
      { where: { id: "holder" }, data: { offerExpiresAt: null, offerEndedReason: "moved" } },
      { where: { id: ID.registration }, data: { offeredAt: NOW, offerExpiresAt: IN_3_DAYS, offerEndedReason: null } },
    ]);
    expect(db.notification.create.mock.calls.map(([arg]) => [arg.data.recipientId, arg.data.type])).toEqual([
      ["att-chosen", "waitlist_offer"],
      ["att-holder", "waitlist_offer_ended"],
    ]);
  });

  it.each([
    ["no place is under offer", chosen(), null, "There is no place on offer to give to someone else."],
    ["the attendee isn't waiting", chosen({ status: "registered" }), null, "Only an attendee on the waiting list can be offered a place."],
    ["the attendee is on another event's list", chosen({ eventId: "elsewhere" }), null, "Only an attendee on the waiting list can be offered a place."],
    ["the registration doesn't exist", null, null, "Only an attendee on the waiting list can be offered a place."],
    ["a place is already offered to them", chosen({ offerExpiresAt: IN_3_DAYS }), null, "A place is already on offer to this attendee."],
  ])("[SPM-66][AC9] refuses when %s", async (_case, row, holder, error) => {
    db.event.findUnique.mockResolvedValue(event());
    db.registration.findUnique.mockResolvedValue(row);
    db.registration.findFirst.mockResolvedValue(holder);

    const res = await post(signIn(coordinator()));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(db.registration.update).not.toHaveBeenCalled();
  });

  it.each([["started", { startsAt: sgt("2026-10-23T09:00:00") }], ["not Confirmed", { status: "postponed" }]])(
    "[SPM-66][AC10] offers nothing once the event has %s",
    async (_case, override) => {
      db.event.findUnique.mockResolvedValue(event(override));

      const res = await post(signIn(coordinator()));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "This event has started, so places are no longer offered." });
    }
  );

  it("[SPM-66] refuses a body without a registration", async () => {
    db.event.findUnique.mockResolvedValue(event());

    expect((await post(signIn(coordinator()), {})).status).toBe(400);
  });

  it("[SPM-66] answers 500 when the database fails", async () => {
    db.event.findUnique.mockRejectedValue(new Error("connection lost"));

    expect((await post(signIn(coordinator()))).status).toBe(500);
  });
});

describe("PATCH /api/events/[id]/registration - a raised capacity", () => {
  const patch = (body: unknown) =>
    configure(req("PATCH", `/api/events/${REF}/registration`, { token: signIn(coordinator()), body }), params({ id: REF }));

  /// The event's approved booking the capacity is measured against (SPM-64).
  const booking = {
    id: ID.booking,
    status: "approved",
    layoutName: "classroom",
    venue: { name: "Orchard Seminar Room", code: "ORC-SEM", layouts: [{ layoutName: "classroom", capacity: 70 }] },
  };

  it("[SPM-66][AC5] SPM-66-TC05: offers the new places to the waiting list when the capacity is raised", async () => {
    db.event.findUnique.mockResolvedValue(event());
    db.venueBooking.findMany.mockResolvedValue([booking]);
    db.registration.count.mockResolvedValue(2);
    db.event.update.mockResolvedValue(event({ registrationCapacity: 3 }));

    expect((await patch({ registrationCapacity: 3 })).status).toBe(200);

    expect(db.$transaction).toHaveBeenCalled();
    const [sql] = db.$queryRaw.mock.calls[0] as [string[]];
    expect(sql.join("?")).toContain("FOR UPDATE");
  });

  it("[SPM-66][AC5] offers places when registration is turned back on", async () => {
    db.event.findUnique.mockResolvedValue(event({ registrationEnabled: false, registrationVenueBookingId: ID.booking }));
    db.venueBooking.findMany.mockResolvedValue([booking]);
    db.registration.count.mockResolvedValue(2);
    db.event.update.mockResolvedValue(event());

    expect((await patch({ registrationEnabled: true })).status).toBe(200);
    expect(db.$transaction).toHaveBeenCalled();
  });

  it("[SPM-66][AC5] offers nothing when the capacity is unchanged", async () => {
    db.event.findUnique.mockResolvedValue(event());
    db.event.update.mockResolvedValue(event());

    await patch({ registrationClosesAt: sgt("2026-11-29T17:00:00").toISOString() });

    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

// SPM-66 (AC7, AC10): offers whose time is up end before anything shows them
// as standing - the same pattern as SPM-82's hold expiry.
describe("ending offers whose time is up, before reading", () => {
  it("[SPM-66][AC7][AC10] on the event page", async () => {
    db.event.findUnique.mockResolvedValue(null);

    await eventDetail(req("GET", `/api/events/${REF}`, { token: signIn(attendee()) }), params({ id: REF }));

    expect(waitingListSweepOrder()).toBeLessThan(db.event.findUnique.mock.invocationCallOrder[0]);
  });

  it("[SPM-66][AC7][AC10] not for a reference that cannot exist", async () => {
    await eventDetail(req("GET", "/api/events/nope", { token: signIn(attendee()) }), params({ id: "nope" }));

    expect(waitingListSweepOrder()).toBeNull();
  });

  it("[SPM-66][AC3][AC7] on My Registrations, which then gives each waiting one its position", async () => {
    db.registration.findMany
      .mockResolvedValueOnce([
        { id: "w", eventId: ID.event, status: "waitlisted", registeredAt: NOW, offerExpiresAt: null, event: {} },
        { id: "r", eventId: ID.event, status: "registered", registeredAt: NOW, offerExpiresAt: null, event: {} },
      ])
      .mockResolvedValueOnce([
        { id: "ahead", waitlistedAt: sgt("2026-10-20T09:00:00"), registeredAt: NOW },
        { id: "w", waitlistedAt: sgt("2026-10-21T09:00:00"), registeredAt: NOW },
      ]);

    const res = await myRegistrations(req("GET", "/api/registrations", { token: signIn(attendee()) }));

    expect(waitingListSweepOrder()).toBeLessThan(db.registration.findMany.mock.invocationCallOrder[0]);
    expect((await res.json()).map((r: { id: string; waitingListPosition: number | null }) => [r.id, r.waitingListPosition])).toEqual([
      ["w", 2],
      ["r", null],
    ]);
  });

  it("[SPM-66][AC7][AC10] on the event's registration list", async () => {
    db.event.findUnique.mockResolvedValue(event());
    db.registration.findMany.mockResolvedValue([]);
    db.registration.groupBy.mockResolvedValue([]);

    await registrationList(req("GET", `/api/events/${REF}/registrations`, { token: signIn(coordinator()) }), params({ id: REF }));

    expect(waitingListSweepOrder()).toBeLessThan(db.registration.findMany.mock.invocationCallOrder[0]);
  });

  it("[SPM-66][AC7][AC10] on every page, through the unread count", async () => {
    db.notification.count.mockResolvedValue(0);

    await unreadCount(req("GET", "/api/notifications/unread-count", { token: signIn(attendee()) }));

    expect(waitingListSweepOrder()).toBeLessThan(db.notification.count.mock.invocationCallOrder[0]);
  });
});

// SPM-66 (AC3, AC9): what the coordinator's Attendees tab is given.
describe("GET /api/events/[id]/registrations - the waiting list", () => {
  const list = (actor = coordinator(), row = event()) => {
    db.event.findUnique.mockResolvedValue(row);
    db.registration.groupBy.mockResolvedValue([]);
    // The list also reads the venue bookings, for SPM-57's venue capacity.
    db.venueBooking.findMany.mockResolvedValue([]);
    return registrationList(req("GET", `/api/events/${REF}/registrations`, { token: signIn(actor) }), params({ id: REF }));
  };
  const reg = (id: string, status: string, joined: string | null, offerExpiresAt: Date | null = null) => ({
    id,
    status,
    registeredAt: sgt("2026-10-01T09:00:00"),
    withdrawnAt: null,
    waitlistedAt: joined && sgt(joined),
    offeredAt: offerExpiresAt && NOW,
    offerExpiresAt,
    attendee: { fullName: id, email: `${id}@example.com`, phone: null },
    addedBy: null,
  });

  it("[SPM-66][AC3] SPM-66-TC08: numbers each waiting attendee first in, first out, and gives the offer standing", async () => {
    db.registration.findMany.mockResolvedValue([
      reg("seated", "registered", null),
      reg("second", "waitlisted", "2026-10-21T09:00:00"),
      reg("first", "waitlisted", "2026-10-20T09:00:00", IN_3_DAYS),
    ]);

    const body = await (await list()).json();

    expect(body.registrations.map((r: { id: string; waitingListPosition: number | null }) => [r.id, r.waitingListPosition])).toEqual([
      ["seated", null],
      ["second", 2],
      ["first", 1],
    ]);
    expect(body.registrations[2].offerExpiresAt).toBe(IN_3_DAYS.toISOString());
  });

  it("[SPM-66][AC9] lets the assigned coordinator offer places while the event is Confirmed and ahead", async () => {
    db.registration.findMany.mockResolvedValue([]);

    expect((await (await list()).json()).canOfferPlaces).toBe(true);
  });

  it.each([
    ["the organiser", () => user("organiser", { id: ID.thirdUser }), event()],
    ["the coordinator, once the event has started", coordinator, event({ startsAt: sgt("2026-10-23T09:00:00") })],
    ["the coordinator, while the event isn't Confirmed", coordinator, event({ status: "postponed" })],
  ])("[SPM-66][AC9][AC10] doesn't let %s offer places", async (_who, actor, row) => {
    db.registration.findMany.mockResolvedValue([]);

    expect((await (await list(actor(), row)).json()).canOfferPlaces).toBe(false);
  });
});
