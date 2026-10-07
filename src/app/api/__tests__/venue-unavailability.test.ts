// SPM-45 (Record Venue Unavailability). Written before the code, as its contract:
//   src/app/api/venues/[id]/unavailability/route.ts              exports GET, POST
//   src/app/api/venues/[id]/unavailability/[periodId]/route.ts   exports PATCH, DELETE
//
//   Every handler: 401; 403 "Only Venue Staff can mark a venue unavailable" without
//   venue:manage; 404 "Venue not found"; 500.
//   GET    -> 200 [{ id, fromDay, fromSlot, untilDay, untilSlot, reason, otherReason }] - the venue's
//             periods that are not over yet, earliest first.
//   POST   { fromDay, fromSlot, untilDay, untilSlot, reason, otherReason? }
//          -> 201 { period, flaggedBookings }; 400 with Zod details.
//   PATCH  the same body -> 200 { period, flaggedBookings };
//          404 "Unavailable period not found" (missing, or another venue's).
//   DELETE -> 200 { ended: true }; 404 as PATCH; 400 "This unavailable period is already over."
//
//   The period is a VenueUnavailability row: startsAt is the start of the first
//   unavailable slot, endsAt the start of the first available slot (Singapore time).
//   otherReason is required when reason is "other" and is stored, trimmed, in the
//   notes column; for any other reason notes is null and otherReason is ignored.
//   The venue is read with venue.findUnique, a period with venueUnavailability.findUnique,
//   and the bookings to judge with venueBooking.findMany - the same candidates
//   SPM-39 uses (approved, not finished), each with its session and event.
//   A booking is flagged when the period covers a slot it holds, setup and
//   turnaround included: needsReview, reviewReason "venue_unavailable" (merged
//   into any reasons already there), flaggedAt; and its coordinator notified.
//   A booking is never changed in any other way.
// Decided here, not in the story (change the test if the team wants otherwise):
//   - the refusal and validation wording, and the notification's type and title
//   - a change flags only the bookings the period did not cover before
//   - ending a period under way sets its end to now; one not started is deleted
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/prisma");

import { GET, POST } from "@/app/api/venues/[id]/unavailability/route";
import { PATCH, DELETE } from "@/app/api/venues/[id]/unavailability/[periodId]/route";
import { callArg, db, ID, params, req, signIn, user } from "@/test/kit";

const PERIOD_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const COORDINATOR_ID = "coordinator-id";
const REQUESTER_ID = "requester-id";
const OTHERS = ["organiser", "coordinator", "ops_manager", "tech_support", "attendee"];

/// A Singapore wall-clock time as an instant (UTC+8, no daylight saving).
const sgt = (day: string, time: string) => new Date(`${day}T${time}:00+08:00`);

/// Before every fixture date below, so each booking is still to come.
const NOW = sgt("2026-10-06", "10:00");

/// Unavailable from 10 Jun 2027 PM, available again from 15 Jun 2027 PM.
const body = {
  fromDay: "2027-06-10",
  fromSlot: "PM",
  untilDay: "2027-06-15",
  untilSlot: "PM",
  reason: "equipment_failure",
};
/// The same period, for a reason that is not on the list.
const other = { ...body, reason: "other", otherReason: "Film crew on site" };
const STARTS = sgt("2027-06-10", "13:00");
const ENDS = sgt("2027-06-15", "13:00");

function venue(overrides: Record<string, unknown> = {}) {
  return { id: ID.venue, code: "HALL-A", name: "Hall A", isActive: true, setupMinutes: 0, teardownMinutes: 0, ...overrides };
}

function period(overrides: Record<string, unknown> = {}) {
  return {
    id: PERIOD_ID,
    venueId: ID.venue,
    startsAt: STARTS,
    endsAt: ENDS,
    reason: "equipment_failure",
    notes: null,
    ...overrides,
  };
}

/// An approved booking of the venue holding one slot of one day.
function booking(id: string, title: string, day: string, slot: "AM" | "PM", overrides: Record<string, unknown> = {}) {
  const [from, to] = slot === "AM" ? ["07:00", "12:00"] : ["13:00", "18:00"];
  return {
    id,
    eventId: `event-${id}`,
    sessionId: null,
    session: null,
    layoutName: "theatre",
    status: "approved",
    needsReview: false,
    reviewReason: null,
    requestedBy: REQUESTER_ID,
    startsAt: sgt(day, from),
    endsAt: sgt(day, to),
    event: { id: `event-${id}`, title, coordinatorId: COORDINATOR_ID },
    ...overrides,
  };
}

/// The four bookings of the manual test cases: one either side of each edge.
const before = () => booking("b-before", "Morning Briefing", "2027-06-10", "AM");
const first = () => booking("b-first", "Afternoon Workshop", "2027-06-10", "PM");
const last = () => booking("b-last", "Closing Seminar", "2027-06-15", "AM");
const after = () => booking("b-after", "Return Forum", "2027-06-15", "PM");

function given({ stored = venue(), bookings = [], existing = period() }: {
  stored?: object | null;
  bookings?: object[];
  existing?: object | null;
} = {}) {
  const token = signIn(user("venue_staff"));
  db.venue.findUnique.mockResolvedValue(stored);
  db.venueBooking.findMany.mockResolvedValue(bookings);
  db.venueUnavailability.findUnique.mockResolvedValue(existing);
  db.venueUnavailability.findMany.mockResolvedValue(existing ? [existing] : []);
  db.venueUnavailability.create.mockImplementation(async ({ data }: { data: object }) => ({ id: PERIOD_ID, ...data }));
  db.venueUnavailability.update.mockImplementation(async ({ data }: { data: object }) => ({ ...existing, ...data }));
  return token;
}

const LIST = `/api/venues/${ID.venue}/unavailability`;
const ONE = `${LIST}/${PERIOD_ID}`;
const venueParams = () => params({ id: ID.venue });
const periodParams = () => params({ id: ID.venue, periodId: PERIOD_ID });

const list = (token?: string) => GET(req("GET", LIST, { token }), venueParams());
const create = (token: string | undefined, sent: unknown = body) => POST(req("POST", LIST, { token, body: sent }), venueParams());
const change = (token: string | undefined, sent: unknown = body) => PATCH(req("PATCH", ONE, { token, body: sent }), periodParams());
const end = (token?: string) => DELETE(req("DELETE", ONE, { token }), periodParams());

const flaggedIds = () => db.venueBooking.update.mock.calls.map(([arg]) => arg.where.id);

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/venues/[id]/unavailability", () => {
  it("is 401 without a session", async () => {
    expect((await list()).status).toBe(401);
  });

  it.each(OTHERS)("is 403 for %s", async (role) => {
    const res = await list(signIn(user(role)));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only Venue Staff can mark a venue unavailable" });
    expect(db.venueUnavailability.findMany).not.toHaveBeenCalled();
  });

  it("is 404 for a venue that does not exist", async () => {
    const res = await list(given({ stored: null }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Venue not found" });
  });

  it("lists the periods that are not over yet, earliest first, as days and slots", async () => {
    vi.useFakeTimers({ now: NOW });
    const token = given();

    const res = await list(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        id: PERIOD_ID,
        fromDay: "2027-06-10",
        fromSlot: "PM",
        untilDay: "2027-06-15",
        untilSlot: "PM",
        reason: "equipment_failure",
        otherReason: null,
      },
    ]);
    expect(callArg(db.venueUnavailability.findMany)).toMatchObject({
      where: { venueId: ID.venue, endsAt: { gt: NOW } },
      orderBy: { startsAt: "asc" },
    });
  });

  it("answers 500 when the database fails", async () => {
    const token = given();
    db.venue.findUnique.mockRejectedValue(new Error("connection lost"));

    expect((await list(token)).status).toBe(500);
  });
});

describe("POST /api/venues/[id]/unavailability", () => {
  it("is 401 without a session", async () => {
    expect((await create(undefined)).status).toBe(401);
  });

  it.each(OTHERS)("is 403 for %s", async (role) => {
    const res = await create(signIn(user(role)));

    expect(res.status).toBe(403);
    expect(db.venueUnavailability.create).not.toHaveBeenCalled();
  });

  it("is 404 for a venue that does not exist", async () => {
    const res = await create(given({ stored: null }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Venue not found" });
    expect(db.venueUnavailability.create).not.toHaveBeenCalled();
  });

  it("records the period from its first unavailable slot to its first available slot", async () => {
    const token = given();

    const res = await create(token);

    expect(res.status).toBe(201);
    expect(callArg(db.venueUnavailability.create).data).toEqual({
      venueId: ID.venue,
      startsAt: STARTS,
      endsAt: ENDS,
      reason: "equipment_failure",
      notes: null,
      createdBy: ID.user,
    });
  });

  it("answers with the period as days and slots, and nothing flagged when no booking is affected", async () => {
    const json = await (await create(given())).json();

    expect(json.period).toEqual({ id: PERIOD_ID, ...body, otherReason: null });
    expect(json.flaggedBookings).toEqual([]);
    expect(db.venueBooking.update).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("saves the description of an Other reason, trimmed", async () => {
    const res = await create(given(), { ...other, otherReason: "  Film crew on site " });

    expect(res.status).toBe(201);
    expect(callArg(db.venueUnavailability.create).data).toMatchObject({ reason: "other", notes: "Film crew on site" });
    expect((await res.json()).period).toMatchObject({ reason: "other", otherReason: "Film crew on site" });
  });

  it("ignores a description sent with a reason that is on the list", async () => {
    const res = await create(given(), { ...body, otherReason: "Film crew on site" });

    expect(res.status).toBe(201);
    expect(callArg(db.venueUnavailability.create).data.notes).toBeNull();
  });

  it("accepts a period of a single slot", async () => {
    const res = await create(given(), { ...body, untilDay: "2027-06-10", untilSlot: "Night" });

    expect(res.status).toBe(201);
    expect(callArg(db.venueUnavailability.create).data).toMatchObject({
      startsAt: sgt("2027-06-10", "13:00"),
      endsAt: sgt("2027-06-10", "19:00"),
    });
  });

  it("leaves the venue itself active - the room is not retired", async () => {
    const res = await create(given());

    expect(res.status).toBe(201);
    expect(db.venue.update).not.toHaveBeenCalled();
  });

  describe("what it refuses", () => {
    it.each([
      ["the same slot", { untilDay: "2027-06-10", untilSlot: "PM" }],
      ["an earlier slot of the same day", { untilDay: "2027-06-10", untilSlot: "AM" }],
      ["an earlier day", { untilDay: "2027-06-09", untilSlot: "Night" }],
    ])("a return in %s", async (_case, until) => {
      const res = await create(given(), { ...body, ...until });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.details.fieldErrors.untilDay).toEqual([
        "The venue must become available again after it becomes unavailable.",
      ]);
      expect(db.venueUnavailability.create).not.toHaveBeenCalled();
    });

    it.each([
      ["no reason", { reason: undefined }, "reason"],
      ["a reason that is not on the list", { reason: "holiday" }, "reason"],
      ["no start date", { fromDay: undefined }, "fromDay"],
      ["a start date that is not a real date", { fromDay: "2027-02-31" }, "fromDay"],
      ["no return date", { untilDay: undefined }, "untilDay"],
      ["a slot that does not exist", { fromSlot: "Evening" }, "fromSlot"],
      ["Other with no description", { reason: "other" }, "otherReason"],
      ["Other with a description of spaces only", { reason: "other", otherReason: "   " }, "otherReason"],
      ["Other with a description longer than 500 characters", { reason: "other", otherReason: "x".repeat(501) }, "otherReason"],
    ])("%s", async (_case, change, field) => {
      const res = await create(given(), { ...body, ...change });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.details.fieldErrors).toHaveProperty(field);
      expect(db.venueUnavailability.create).not.toHaveBeenCalled();
    });

    it("says what is missing when Other has no description", async () => {
      const json = await (await create(given(), { ...body, reason: "other" })).json();

      expect(json.details.fieldErrors.otherReason).toEqual(["Describe the reason."]);
    });
  });

  describe("bookings inside the period", () => {
    it("only considers approved bookings that have not finished yet", async () => {
      vi.useFakeTimers({ now: NOW });

      await create(given());

      expect(callArg(db.venueBooking.findMany).where).toEqual({
        venueId: ID.venue,
        status: "approved",
        endsAt: { gt: NOW },
      });
    });

    it("flags the bookings in its first and last slots, and not the ones either side", async () => {
      const token = given({ bookings: [before(), first(), last(), after()] });

      const json = await (await create(token)).json();

      expect(flaggedIds()).toEqual(["b-first", "b-last"]);
      expect(json.flaggedBookings.map((b: { eventTitle: string }) => b.eventTitle)).toEqual([
        "Afternoon Workshop",
        "Closing Seminar",
      ]);
    });

    it("flags a booking for review without changing anything else about it", async () => {
      vi.useFakeTimers({ now: NOW });
      const token = given({ bookings: [first()] });

      await create(token);

      expect(callArg(db.venueBooking.update)).toEqual({
        where: { id: "b-first" },
        data: { needsReview: true, reviewReason: "venue_unavailable", flaggedAt: NOW },
      });
    });

    it("reports what was flagged and who was told", async () => {
      const json = await (await create(given({ bookings: [first()] }))).json();

      expect(json.flaggedBookings).toEqual([
        {
          bookingId: "b-first",
          eventId: "event-b-first",
          eventTitle: "Afternoon Workshop",
          sessionId: null,
          sessionLabel: null,
          reasons: ["venue_unavailable"],
          notifiedUserId: COORDINATOR_ID,
        },
      ]);
    });

    it("notifies the event's assigned coordinator, naming the venue, the event and the reason", async () => {
      await create(given({ bookings: [first()] }));
      const notification = callArg(db.notification.create).data;

      expect(notification).toMatchObject({
        recipientId: COORDINATOR_ID,
        type: "booking_venue_unavailable",
        title: "Venue unavailable - booking needs review",
        eventId: "event-b-first",
      });
      expect(notification.body).toContain("Hall A");
      expect(notification.body).toContain("the venue is unavailable during this booking");
      expect(notification.body).toContain("The approved booking for Afternoon Workshop on ");
      expect(notification.body).toContain("nothing has been changed automatically.");
      expect(notification.body).toContain("Equipment failure");
    });

    it("gives the coordinator the description when the reason is Other", async () => {
      await create(given({ bookings: [first()] }), other);

      expect(callArg(db.notification.create).data.body).toContain("Film crew on site");
    });

    it("notifies the person who requested the booking when the event has no coordinator", async () => {
      const unassigned = { ...first(), event: { ...first().event, coordinatorId: null } };

      await create(given({ bookings: [unassigned] }));

      expect(callArg(db.notification.create).data.recipientId).toBe(REQUESTER_ID);
    });

    it("names the session when the booking belongs to one", async () => {
      const sessionBooking = { ...first(), sessionId: ID.session, session: { label: "Day 2" } };

      const json = await (await create(given({ bookings: [sessionBooking] }))).json();

      expect(json.flaggedBookings[0]).toMatchObject({ sessionId: ID.session, sessionLabel: "Day 2" });
      expect(callArg(db.notification.create).data.body).toContain("(Day 2)");
    });

    it("keeps the reasons an earlier venue change already flagged", async () => {
      const alreadyFlagged = { ...first(), needsReview: true, reviewReason: "layout_removed" };

      await create(given({ bookings: [alreadyFlagged] }));

      expect(callArg(db.venueBooking.update).data.reviewReason).toBe("layout_removed,venue_unavailable");
    });

    it("counts a booking whose turnaround slot falls in the period", async () => {
      // Morning Briefing ends before the period; its turnaround takes 10 Jun PM.
      const token = given({ stored: venue({ teardownMinutes: 30 }), bookings: [before()] });

      await create(token);

      expect(flaggedIds()).toEqual(["b-before"]);
    });

    it("counts a booking whose setup slot falls in the period", async () => {
      // Return Forum starts as the venue returns; its setup takes 15 Jun AM.
      const token = given({ stored: venue({ setupMinutes: 60 }), bookings: [after()] });

      await create(token);

      expect(flaggedIds()).toEqual(["b-after"]);
    });
  });

  it("answers 500 when the database fails", async () => {
    const token = given();
    db.venueUnavailability.create.mockRejectedValue(new Error("connection lost"));

    expect((await create(token)).status).toBe(500);
  });
});

describe("PATCH /api/venues/[id]/unavailability/[periodId]", () => {
  /// 9 Jun Night to 16 Jun AM: one slot wider at each end than the stored period.
  const wider = { ...body, fromDay: "2027-06-09", fromSlot: "Night", untilDay: "2027-06-16", untilSlot: "AM" };

  it("is 401 without a session", async () => {
    expect((await change(undefined)).status).toBe(401);
  });

  it.each(OTHERS)("is 403 for %s", async (role) => {
    const res = await change(signIn(user(role)));

    expect(res.status).toBe(403);
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
  });

  it.each([
    ["does not exist", null],
    ["belongs to another venue", period({ venueId: ID.otherVenue })],
  ])("is 404 for a period that %s", async (_case, existing) => {
    const res = await change(given({ existing }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Unavailable period not found" });
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
  });

  it("is 404 for a venue that does not exist", async () => {
    const res = await change(given({ stored: null }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Venue not found" });
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
  });

  it("saves the new dates, slots and reason", async () => {
    const token = given();

    const res = await change(token, { ...wider, reason: "other", otherReason: " Film crew on site " });

    expect(res.status).toBe(200);
    expect(callArg(db.venueUnavailability.update)).toEqual({
      where: { id: PERIOD_ID },
      data: {
        startsAt: sgt("2027-06-09", "19:00"),
        endsAt: sgt("2027-06-16", "07:00"),
        reason: "other",
        notes: "Film crew on site",
      },
    });
    expect((await res.json()).period).toEqual({ id: PERIOD_ID, ...wider, reason: "other", otherReason: "Film crew on site" });
  });

  it("flags only the bookings the wider period newly covers", async () => {
    const eveningBefore = { ...before(), startsAt: sgt("2027-06-09", "19:00"), endsAt: sgt("2027-06-10", "00:00") };
    const token = given({ bookings: [eveningBefore, first(), last(), after()] });

    const json = await (await change(token, wider)).json();

    expect(flaggedIds()).toEqual(["b-before", "b-after"]);
    expect(json.flaggedBookings).toHaveLength(2);
    expect(db.notification.create).toHaveBeenCalledTimes(2);
  });

  it("flags nothing, and clears nothing, when the period is made shorter", async () => {
    const shorter = { ...body, fromDay: "2027-06-11", fromSlot: "AM" };
    const token = given({ bookings: [{ ...first(), needsReview: true, reviewReason: "venue_unavailable" }] });

    const json = await (await change(token, shorter)).json();

    expect(json.flaggedBookings).toEqual([]);
    expect(db.venueBooking.update).not.toHaveBeenCalled();
  });

  it("refuses a return that is not later than the start", async () => {
    const res = await change(given(), { ...body, untilDay: "2027-06-10", untilSlot: "PM" });

    expect(res.status).toBe(400);
    expect((await res.json()).details.fieldErrors.untilDay).toEqual([
      "The venue must become available again after it becomes unavailable.",
    ]);
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
  });

  it("refuses a change with no reason", async () => {
    const res = await change(given(), { ...body, reason: undefined });

    expect(res.status).toBe(400);
    expect((await res.json()).details.fieldErrors).toHaveProperty("reason");
  });

  it("clears the description when the reason is changed from Other to one on the list", async () => {
    const token = given({ existing: period({ reason: "other", notes: "Film crew on site" }) });

    await change(token, { ...body, reason: "safety" });

    expect(callArg(db.venueUnavailability.update).data).toMatchObject({ reason: "safety", notes: null });
  });

  it("refuses a change to Other with no description", async () => {
    const res = await change(given(), { ...body, reason: "other" });

    expect(res.status).toBe(400);
    expect((await res.json()).details.fieldErrors.otherReason).toEqual(["Describe the reason."]);
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
  });

  it("answers 500 when the database fails", async () => {
    const token = given();
    db.venueUnavailability.update.mockRejectedValue(new Error("connection lost"));

    expect((await change(token)).status).toBe(500);
  });
});

describe("DELETE /api/venues/[id]/unavailability/[periodId] - ending a period early", () => {
  it("is 401 without a session", async () => {
    expect((await end()).status).toBe(401);
  });

  it.each(OTHERS)("is 403 for %s", async (role) => {
    const res = await end(signIn(user(role)));

    expect(res.status).toBe(403);
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
    expect(db.venueUnavailability.delete).not.toHaveBeenCalled();
  });

  it.each([
    ["does not exist", null],
    ["belongs to another venue", period({ venueId: ID.otherVenue })],
  ])("is 404 for a period that %s", async (_case, existing) => {
    const res = await end(given({ existing }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Unavailable period not found" });
  });

  it("is 404 for a venue that does not exist", async () => {
    const res = await end(given({ stored: null }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Venue not found" });
    expect(db.venueUnavailability.delete).not.toHaveBeenCalled();
  });

  it("ends a period that is under way at this moment, keeping the record of it", async () => {
    const duringIt = sgt("2027-06-12", "10:00");
    vi.useFakeTimers({ now: duringIt });
    const token = given();

    const res = await end(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ended: true });
    expect(callArg(db.venueUnavailability.update)).toEqual({ where: { id: PERIOD_ID }, data: { endsAt: duringIt } });
    expect(db.venueUnavailability.delete).not.toHaveBeenCalled();
  });

  it("removes a period that has not started yet", async () => {
    vi.useFakeTimers({ now: NOW });
    const token = given();

    const res = await end(token);

    expect(res.status).toBe(200);
    expect(callArg(db.venueUnavailability.delete)).toEqual({ where: { id: PERIOD_ID } });
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
  });

  it("refuses a period that is already over", async () => {
    vi.useFakeTimers({ now: sgt("2027-06-15", "13:00") });
    const token = given();

    const res = await end(token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This unavailable period is already over." });
    expect(db.venueUnavailability.update).not.toHaveBeenCalled();
    expect(db.venueUnavailability.delete).not.toHaveBeenCalled();
  });

  it("leaves bookings and their flags alone", async () => {
    vi.useFakeTimers({ now: NOW });

    const res = await end(given({ bookings: [{ ...first(), needsReview: true, reviewReason: "venue_unavailable" }] }));

    expect(res.status).toBe(200);
    expect(db.venueBooking.update).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it("answers 500 when the database fails", async () => {
    const token = given();
    db.venueUnavailability.findUnique.mockRejectedValue(new Error("connection lost"));

    expect((await end(token)).status).toBe(500);
  });
});
